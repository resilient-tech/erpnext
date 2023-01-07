# Copyright (c) 2019, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


from collections import Counter

import frappe
from frappe import _
from frappe.desk.form.assign_to import add as add_assignment
from frappe.model.document import Document
from frappe.share import add_docshare
from frappe.utils import get_url, getdate, now
from frappe.utils.verified_command import get_signed_params


class Appointment(Document):
	def __init__(self, *args, **kwargs):
		super().__init__(*args, **kwargs)
		self.settings = frappe.get_cached_doc("Appointment Booking Settings")

	def before_insert(self):
		total_scheduled_appointments = frappe.db.count(
			"Appointment", filters={"scheduled_time": self.scheduled_time}
		)
		total_agents = self.settings.number_of_agents

		if total_agents and total_scheduled_appointments >= total_agents:
			frappe.throw(_("Time slot is not available"))

		# Link lead or customer if email matches
		party = self.get_party_by_email()

		if not party:
			return

		self.appointment_with = party["doctype"]
		self.party = party["name"]

	def after_insert(self):
		if self.party:
			self.auto_assign_agent()
			self.create_calendar_event()
			return

		self.status = "Unverified"
		self.send_confirmation_email()

	def on_change(self):
		# Sync Calendar
		if not self.calendar_event:
			return

		calender_event = frappe.get_doc("Event", self.calendar_event)
		calender_event.starts_on = self.scheduled_time
		calender_event.save(ignore_permissions=True)

	def get_party_by_email(self):
		for doctype in ("Customer", "Lead"):
			party = frappe.get_all(doctype, filters={"email_id": self.customer_email})
			if party:
				return {
					"doctype": doctype,
					"name": party[0].name,
				}
		return None

	def auto_assign_agent(self):
		if self._assign:
			return

		existing_assignee = self.get_assignee_from_latest_opportunity()
		if existing_assignee:
			self.assign_agent(existing_assignee)
			return

		available_agents = self.get_agents_sorted_by_asc_workload()
		for agent in available_agents:
			if check_agent_availability(agent, self.scheduled_time):
				self.assign_agent(agent[0])
			break

	def send_confirmation_email(self):
		args = {
			"link": self._get_verify_url(),
			"site_url": frappe.utils.get_url(),
			"full_name": self.customer_name,
		}

		frappe.sendmail(
			recipients=[self.customer_email],
			template="confirm_appointment",
			args=args,
			subject=_("Appointment Confirmation"),
		)

		message = _("Please check your email to confirm the appointment")

		if frappe.session.user != "Guest":
			message = _("Appointment was created. But no lead was found. ") + message

		frappe.msgprint(message)

	def set_verified(self, email):
		if not email == self.customer_email:
			frappe.throw(_("Email verification failed."))

		self.create_lead()
		self.status = "Open"
		# Create calender event
		self.auto_assign_agent()
		self.create_calendar_event()
		self.save(ignore_permissions=True)

	def create_lead(self):
		if self.party:
			return

		lead = frappe.get_doc(
			{
				"doctype": "Lead",
				"lead_name": self.customer_name,
				"email_id": self.customer_email,
				"phone": self.customer_phone_number,
			}
		)

		if self.customer_details:
			lead.append(
				"notes",
				{
					"note": self.customer_details,
					"added_by": frappe.session.user,
					"added_on": now(),
				},
			)

		lead.insert(ignore_permissions=True)
		self.party = lead.name

	def get_assignee_from_latest_opportunity(self):
		if not self.party:
			return

		opporutnities = frappe.get_all(
			"Opportunity",
			filters={
				"party_name": self.party,
			},
			fields=["name", "_assign"],
			order_by="creation desc",
		)

		if not opporutnities:
			return

		assignee = opporutnities[0]._assign
		if not assignee:
			return

		assignee = frappe.parse_json(assignee)[0]
		return assignee

	def create_calendar_event(self):
		if self.calendar_event:
			return

		appointment_event = frappe.get_doc(
			{
				"doctype": "Event",
				"subject": f"Appointment with {self.customer_name}",
				"starts_on": self.scheduled_time,
				"status": "Open",
				"type": "Public",
				"send_reminder": self.settings.email_reminders,
				"event_participants": [
					dict(reference_doctype=self.appointment_with, reference_docname=self.party)
				],
			}
		)

		employee = _get_employee_from_user(self._assign)
		if employee:
			appointment_event.append(
				"event_participants", dict(reference_doctype="Employee", reference_docname=employee)
			)

		appointment_event.insert(ignore_permissions=True)
		self.db_set("calendar_event", appointment_event.name)

	def _get_verify_url(self):
		params = {"email": self.customer_email, "appointment": self.name}

		signed_params = get_signed_params(params)
		verify_url = get_url(f"/book_appointment/verify?{signed_params}")
		return verify_url

	def assign_agent(self, agent):
		if not frappe.has_permission(doc=self, user=agent):
			add_docshare(self.doctype, self.name, agent, flags={"ignore_share_permission": True})

		add_assignment({"doctype": self.doctype, "name": self.name, "assign_to": [agent]})

	def get_agents_sorted_by_asc_workload(self):
		date = getdate(self.scheduled_time)
		agent_list = _get_agents_from_settings(self.settings)

		appointments = frappe.get_all("Appointment", fields="*")
		if not appointments:
			return agent_list

		appointment_counter = Counter(agent_list)
		for appointment in appointments:
			if not appointment._assign:
				continue

			assigned_to = frappe.parse_json(appointment._assign)

			if (assigned_to[0] in agent_list) and getdate(appointment.scheduled_time) == date:
				appointment_counter[assigned_to[0]] += 1

		sorted_agent_list = appointment_counter.most_common()
		sorted_agent_list.reverse()
		return sorted_agent_list


def _get_agents_from_settings(settings):
	agents_list = list(agent.user for agent in settings.agent_list)
	return agents_list


def check_agent_availability(agent_email, scheduled_time):
	appointments_at_scheduled_time = frappe.get_all(
		"Appointment", filters={"scheduled_time": scheduled_time}
	)
	for appointment in appointments_at_scheduled_time:
		if appointment._assign == agent_email:
			return False
	return True


def _get_employee_from_user(user):
	return frappe.get_cached_value("Employee", {"user_id": user})

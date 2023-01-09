import datetime

import frappe
from frappe import _
from frappe.utils.data import get_datetime, get_time, get_weekday
from pytz import timezone

no_cache = 1


def get_context(context):
	is_enabled = frappe.db.get_single_value("Appointment Booking Settings", "enable_scheduling")

	if not is_enabled:
		frappe.redirect_to_message(
			_("Appointment Scheduling Disabled"),
			_("Appointment Scheduling has been disabled for this site"),
			http_status_code=302,
			indicator_color="red",
		)
		raise frappe.Redirect

	return context


class BookAppointment:
	def __init__(self, date, timezone) -> None:
		self.date = date
		self.timezone = timezone

	def get_appointment_slots(self):
		self.set_default_data()
		self.set_system_day_start_end_datetime()
		available_slots = self.get_available_slots()
		now_datetime = self.convert_to_guest_timezone(datetime.datetime.now())

		available_timeslots = []
		for slot in available_slots:
			if slot.date() != self.day_start.date():
				continue

			slot_dict = frappe._dict(
				from_time=slot.strftime("%I:%M %p"),
				to_time=(slot + self.appointment_duration).strftime("%I:%M %p"),
			)

			if _is_holiday(slot.date(), self.holiday_list):
				available_timeslots.append(slot_dict.update(availability=False))
				continue

			if check_availabilty(slot, self.settings.number_of_agents) and slot >= now_datetime:
				slot_dict.update(availability=True)
			else:
				slot_dict.update(availability=False)

			available_timeslots.append(slot_dict)

		return available_timeslots

	def create_appointment(self, time, contact):
		appointment_datetime = get_datetime(self.date + " " + time)
		scheduled_time = self.convert_to_system_timezone(appointment_datetime)

		if isinstance(contact, str):
			contact = frappe.parse_json(contact)

		appointment = frappe.get_doc(
			{
				"doctype": "Appointment",
				"scheduled_time": scheduled_time.replace(tzinfo=None),
				"customer_name": contact.name,
				"customer_phone_number": contact.number,
				"customer_skype": contact.skype,
				"customer_details": contact.notes,
				"customer_email": contact.email,
				"status": "Open",
			}
		)
		appointment.insert(ignore_permissions=True)
		return appointment

	def set_default_data(self):
		self.day_start = get_datetime(self.date + " 00:00:00")
		self.day_end = get_datetime(self.date + " 23:59:59")
		self.settings = frappe.get_cached_doc("Appointment Booking Settings")
		self.holiday_list = frappe.get_cached_doc("Holiday List", self.settings.holiday_list)
		self.appointment_duration = datetime.timedelta(minutes=self.settings.appointment_duration)

	def get_available_slots(self):
		selected_day = get_weekday(self.day_start_time)

		available_slots = []
		for slot in self.settings.availability_of_slots:
			if not (slot.day_of_week == selected_day or slot.day_of_week == get_weekday(self.day_end_time)):
				continue

			booking_date = self.day_start_time if slot.day_of_week == selected_day else self.day_end_time

			available_from = get_combined_datetime(booking_date, slot.from_time)
			available_to = get_combined_datetime(booking_date, slot.to_time)

			while available_from < available_to:
				available_slots.append(self.convert_to_guest_timezone(available_from))
				available_from += self.appointment_duration

		return available_slots

	def set_system_day_start_end_datetime(self):
		self.day_start_time = self.convert_to_system_timezone(self.day_start)
		self.day_end_time = self.convert_to_system_timezone(self.day_end)

	def convert_to_system_timezone(self, datetime):
		guest_timezone = timezone(self.timezone).localize(datetime)
		system_timezone = timezone(frappe.utils.get_time_zone())
		system_datetime = guest_timezone.astimezone(system_timezone)
		return system_datetime

	def convert_to_guest_timezone(self, datetime):
		guest_timezone = timezone(self.timezone)
		local_timezone = timezone(frappe.utils.get_time_zone()).localize(datetime)
		guest_datetime = local_timezone.astimezone(guest_timezone)
		return guest_datetime


@frappe.whitelist(allow_guest=True)
def get_appointment_settings():
	settings = frappe.get_cached_value(
		"Appointment Booking Settings",
		None,
		["advance_booking_days", "appointment_duration", "success_redirect_url"],
		as_dict=True,
	)
	return settings


@frappe.whitelist(allow_guest=True)
def get_timezones():
	import pytz

	return pytz.all_timezones


@frappe.whitelist(allow_guest=True)
def get_appointment_slots(date, timezone):
	book_appointment = BookAppointment(date, timezone)
	return book_appointment.get_appointment_slots()


@frappe.whitelist(allow_guest=True)
def create_appointment(date, time, timezone, contact):
	book_appointment = BookAppointment(date, timezone)
	return book_appointment.create_appointment(time, contact)


# Helper Functions
def check_availabilty(timeslot, number_of_agents):
	return frappe.db.count("Appointment", {"scheduled_time": timeslot}) < number_of_agents


def _is_holiday(date, holiday_list):
	"""Returns True if given date is a holiday"""
	for holiday in holiday_list.holidays:
		if holiday.holiday_date == date:
			return True
	return False


def get_combined_datetime(date, time):
	"""Returns a combined datetime object from given date and time objects"""
	return datetime.datetime.combine(date.date(), get_time(time))

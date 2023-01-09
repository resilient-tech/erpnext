# Copyright (c) 2019, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils.data import get_datetime


class AppointmentBookingSettings(Document):
	def validate(self):
		self.validate_availability_of_slots()
		self.set_total_agents()

	def set_total_agents(self):
		self.number_of_agents = len(self.agent_list)

	def validate_availability_of_slots(self):
		for record in self.availability_of_slots:
			from_time = get_datetime(record.from_time)
			to_time = get_datetime(record.to_time)

			if from_time > to_time:
				frappe.throw(
					_("Row #{0}: <b>To Time</b> must be greater than <b>From Time</b> for {1}").format(
						record.idx, record.day_of_week
					)
				)

			self.is_duration_divisible(from_time, to_time)

	def is_duration_divisible(self, from_time, to_time):
		timedelta = to_time - from_time
		if timedelta.total_seconds() % (self.appointment_duration * 60):
			frappe.throw(
				_("The difference between from time and To Time must be a multiple of Appointment")
			)

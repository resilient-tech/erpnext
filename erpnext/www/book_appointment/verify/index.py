import frappe
from frappe import _
from frappe.utils.verified_command import verify_request


def get_context(context):
	if not verify_request():
		context.error = _("This link is invalid or expired. Please make sure you have pasted correctly.")
		return

	try:
		appointment = frappe.get_doc("Appointment", frappe.form_dict["appointment"])
		appointment.set_verified(frappe.form_dict["email"])
		context.success = _("Your email has been verified and your appointment has been scheduled.")
	except Exception:
		context.error = _("Verification failed please check the link.")

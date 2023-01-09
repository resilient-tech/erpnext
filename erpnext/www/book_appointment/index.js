frappe.ready(async () => {
	let book_appointment = new BookTimeSlot();

	$('#back-button').on('click', () => {
		book_appointment.show();
	});

	$('#appointment-date').add('#appointment-timezone').on('change', () => {
		book_appointment.update_availability();
	});

	$('#submit-button').on('click', () => {
		book_appointment.submit();
	});

})

class BookTimeSlot {
	constructor() {
		this.show();
		this.date_picker_element = $('#appointment-date');
		this.timezone_element = $('#appointment-timezone');
		this.timeslot_container = $('#timeslot-container');
	}

	async show() {
		display_time_slot_section();
		await this.get_global_variables();
		this.setup_date_picker();
		this.setup_timezone_selector();
		this.disable_button($('#next-button'));
	}

	async get_global_variables() {
		this.appointment_settings = (await frappe.call({
			method: 'erpnext.www.book_appointment.index.get_appointment_settings'
		})).message;
		this.timezones = (await frappe.call({
			method:'erpnext.www.book_appointment.index.get_timezones'
		})).message;
	}

	setup_date_picker() {
		let today = frappe.datetime.get_today();
		this.date_picker_element.prop({
			'min': today,
			'max': frappe.datetime.add_days(today, this.appointment_settings.advance_booking_days),
		})
	}

	setup_timezone_selector() {
		this.timezones.forEach((timezone) => {
			const option = ($('<option>').val(timezone).text(timezone));
			if (timezone == frappe.boot.time_zone.user) {
				option.attr('selected', true);
			}
			option.appendTo(this.timezone_element);
		})
	}

	update_availability() {
		this.selected_date = this.date_picker_element.val();
		this.selected_timezone = this.timezone_element.val();

		this.clear_time_slots();

		if (!this.selected_date) {
			this.disable_button($('#next-button'));
			frappe.throw(__('Please select a date'));
		}

		this.update_time_slots();
		$('#lead-text').html(__("Select Time"));
	}

	async update_time_slots() {
		let time_slots = await get_time_slots(this.selected_date, this.selected_timezone);

		if (!time_slots.length) {
			let message = __("There are no slots available on this date");
			this.timeslot_container.append(`<p>${message}</p>`);
			return;
		}

		time_slots.forEach((slot) => {
			// Get and append timeslot div
			let timeslot_element = this.get_timeslot_div_layout(slot);
			this.timeslot_container.append(timeslot_element);
		});
		this.set_default_timeslot();
	}

	get_timeslot_div_layout(timeslot) {
		const me = this;
		let timeslot_div = $('<div class="time-slot"></div>');

		if (!timeslot.availability) timeslot_div.addClass('unavailable');

		timeslot_div.html(this.get_slot_layout(timeslot));
		timeslot_div.attr('id', timeslot.from_time.substring(0, 5));
		timeslot_div.on('click', function(event) {
			me.select_time(event.currentTarget);
		});
		return timeslot_div
	}

	get_slot_layout(timeslot) {
		return `
			<span style="font-size: 1.2em;">
				${timeslot.from_time}
			</span><br>
			<span class="text-muted small">
				${__("to") } ${timeslot.to_time}
			</span>
		`;
	}

	select_time(timeslot_div) {
		let next_button = $('#next-button');
		if (timeslot_div.classList.contains('unavailable')) return;

		let selected_element = $('.selected');

		if (!(selected_element.length > 0)) {
			timeslot_div.classList.add('selected');
			this.enable_button(next_button);
			return;
		}

		this.selected_time = timeslot_div.id;
		selected_element[0].classList.remove('selected');
		timeslot_div.classList.add('selected');
		this.enable_button(next_button);

	}

	set_default_timeslot() {
		let timeslots = $('.time-slot');
		// Can't use a forEach here since, we need to break the loop after a timeslot is selected
		for (let i = 0; i < timeslots.length; i++) {
			const timeslot = timeslots[i];
			if (timeslot.classList.contains('unavailable')) { continue };

			timeslot.classList.add('selected');
			break;
		}
	}

	clear_time_slots() {
		// Clear any existing divs in timeslot container
		while($('#timeslot-container').children().length > 0) {
			$('#timeslot-container').children().remove();
		}
		// while (this.timeslot_container.firstChild) {
		//     this.timeslot_container.removeChild(this.timeslot_container.firstChild);
		// }

	}

	setup_details_page() {
		display_details_section();

		// this.setup_search_params();
		$('.date-span').html(moment(this.date_picker_element.val()).format("MMM Do YYYY"));
		$('.time-span').html(moment(this.selected_time, "HH:mm:ss").format("LT"));
	}

	async submit() {
		let button = $('#submit-button');
		this.disable_button(button);

		let form = document.querySelector('#customer-form');
		if (!form.checkValidity()) {
			form.reportValidity();
			this.enable_button(button);
			return;
		}

		let contact = get_form_data();
		frappe.call({
			method: 'erpnext.www.book_appointment.index.create_appointment',
			args: {
				'date': this.selected_date,
				'time': this.selected_time,
				'contact': contact,
				'timezone':this.selected_timezone
			},
			callback: (response)=>{
				if (response.message.status == "Unverified") {
					frappe.show_alert(__("Please check your email to confirm the appointment"))
				} else {
					frappe.show_alert(__("Appointment Created Successfully"));
				}
				setTimeout(()=>{
					let redirect_url = "/";
					let success_url = this.appointment_settings.success_redirect_url;
					if (success_url){
						redirect_url += success_url
					}
					window.location.href = redirect_url;
				}, 5000)
			},
			error: (err)=>{
				frappe.show_alert(__("Something went wrong please try again"));
				this.enable_button(button);
			}
		});
	}

	setup_search_params() {
		let search_params = new URLSearchParams(window.location.search);
		let customer_name = search_params.get("name")
		let customer_email = search_params.get("email")
		let detail = search_params.get("details")
		if (customer_name) {
			let name_input = document.getElementById("customer_name");
			name_input.value = customer_name;
			name_input.disabled = true;
		}
		if(customer_email) {
			let email_input = document.getElementById("customer_email");
			email_input.value = customer_email;
			email_input.disabled = true;
		}
		if(detail) {
			let detail_input = document.getElementById("customer_notes");
			detail_input.value = detail;
			detail_input.disabled = true;
		}
	}

	disable_button(button) {
		button.prop('disabled', true);
	}

	enable_button(button) {
		button.prop('disabled', false);

		if (button.prop('id') !== 'next-button') return;

		button.on('click', function () {
			if (!this.selected_date || !this.selected_time) {
				frappe.msgprint(__("Please select a date and time"));
			}
			this.setup_details_page();
		}.bind(this));
	}
}

function display_time_slot_section() {
	$('#select-date-time').show();
	$('#enter-details').hide();
}

function display_details_section() {
	$('#select-date-time').hide();
	$('#enter-details').show();
}

async function get_time_slots(date, timezone) {
	let slots = (await frappe.call({
		method: 'erpnext.www.book_appointment.index.get_appointment_slots',
		args: {
			date: date,
			timezone: timezone
		}
	})).message;
	return slots;
}

function get_form_data() {
	contact = {};
	let inputs = ['name', 'skype', 'number', 'notes', 'email'];
	inputs.forEach((id) => contact[id] = $(`#customer_${id}`).val())
	return contact
}

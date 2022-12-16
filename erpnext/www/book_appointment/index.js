frappe.ready(async () => {
    let book_appointment = new BookTimeSlot();
    book_appointment.show();

    $('#appointment-date').on('input', () => {
        book_appointment.on_date_or_timezone_select();
    });

    $('#appointment-timezone').on('change', () => {
        book_appointment.on_date_or_timezone_select();
    });

})

class BookTimeSlot {
    constructor() {
        this.date_picker_element = $('#appointment-date');
        this.timezone_element = $('#appointment-timezone');
        this.timeslot_container = $('#timeslot-container');
    }

    async show() {
        $('#select-date-time').show();
        $('#enter-details').hide();
        await this.get_global_variables();
        this.setup_date_picker();
        this.setup_timezone_selector();
        this.hide_next_button();
    }

    async get_global_variables() {
        // Using await through this file instead of then.
        this.appointment_settings = (await frappe.call({
            method: 'erpnext.www.book_appointment.index.get_appointment_settings'
        })).message;
        this.timezones = (await frappe.call({
            method:'frappe.core.doctype.user.user.get_timezones'
        })).message.timezones;
    }

    setup_date_picker() {
        let today = frappe.datetime.get_today();
        this.date_picker_element.prop('min', today);
        this.date_picker_element.prop('max', frappe.datetime.add_days(today, this.appointment_settings.advance_booking_days));
    }

    setup_timezone_selector() {
        let local_timezone = moment.tz.guess();

        this.timezones.forEach((timezone) => {
            const option = ($('<option>').val(timezone).text(timezone));
            if (timezone == local_timezone) {
                option.attr('selected', true);
            }
            option.appendTo(this.timezone_element);
        })
    }

    on_date_or_timezone_select() {
        this.selected_date = this.date_picker_element.val();
        this.selected_timezone = this.timezone_element.val();

        if (!this.selected_date) {
            this.clear_time_slots();
            this.hide_next_button();
            frappe.throw(__('Please select a date'));
        }

        this.update_time_slots();
        $('#lead-text').html(__("Select Time"));
    }

    clear_time_slots() {
        // Clear any existing divs in timeslot container
        let timeslot_container = document.getElementById('timeslot-container');
        while (timeslot_container.firstChild) {
            timeslot_container.removeChild(timeslot_container.firstChild);
        }

    }

    async update_time_slots() {
        let time_slots = await get_time_slots(this.selected_date, this.selected_timezone);
        this.clear_time_slots();

        if (!time_slots.length) {
            let message_div = $('p').html(__("There are no slots available on this date"));
            message_div.appendTo($('#timeslot-container'));
            return;
        }

        time_slots.forEach((slot) => {
            // Get and append timeslot div
            let timeslot_div = this.get_timeslot_div_layout(slot)
            $('#timeslot-container').append(timeslot_div);
        });
        set_default_timeslot();
    }

    get_timeslot_div_layout(timeslot) {
        let timeslot_div = document.createElement('div');
        timeslot_div.classList.add('time-slot');

        if (!timeslot.availability) {
            timeslot_div.classList.add('unavailable')
        }

        timeslot_div.innerHTML = this.get_slot_layout(timeslot.time);
        timeslot_div.id = timeslot.time.substring(11, 19);
        timeslot_div.addEventListener('click', this.select_time);
        return timeslot_div
    }

    get_slot_layout(start_time) {
        let start_time_string = frappe.datetime.get_time(start_time);
        let end_time = moment(start_time).tz(this.selected_timezone).add(this.appointment_settings.appointment_duration, 'minutes');
        let end_time_string = end_time.format("LT");

        return `<span style="font-size: 1.2em;">${start_time_string}</span><br><span class="text-muted small">${__("to") } ${end_time_string}</span>`;
    }

    select_time() {
        if (this.classList.contains('unavailable')) {
            return;
        }
        let selected_element = document.getElementsByClassName('selected');
        if (!(selected_element.length > 0)) {
            this.classList.add('selected');
            this.show_next_button();
            return;
        }
        selected_element = selected_element[0]
        window.selected_time = this.id;
        selected_element.classList.remove('selected');
        this.classList.add('selected');
        this.show_next_button();
    }

    hide_next_button() {
        $('#next-button').prop('disabled', true);
        $('#next-button').click = () => frappe.msgprint(__("Please select a date and time"));
    }

    show_next_button() {
        $('#next-button').prop('disabled', false);
        $('#next-button').click = setup_details_page;
    }

    setup_details_page() {
        $('#select-date-time').hide();
        $('#enter-details').show();
        let date_container = document.getElementsByClassName('date-span')[0];
        let time_container = document.getElementsByClassName('time-span')[0];
        setup_search_params();
        date_container.innerHTML = moment(this.selected_date).format("MMM Do YYYY");
        time_container.innerHTML = moment(this.selected_time, "HH:mm:ss").format("LT");
    }

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

function set_default_timeslot() {
    let timeslots = document.getElementsByClassName('time-slot')
    // Can't use a forEach here since, we need to break the loop after a timeslot is selected
    for (let i = 0; i < timeslots.length; i++) {
        const timeslot = timeslots[i];
        if (!timeslot.classList.contains('unavailable')) {
            timeslot.classList.add('selected');
            break;
        }
    }
}

function setup_details_page() {
    navigate_to_page(2)
    let date_container = document.getElementsByClassName('date-span')[0];
    let time_container = document.getElementsByClassName('time-span')[0];
    setup_search_params();
    date_container.innerHTML = moment(window.selected_date).format("MMM Do YYYY");
    time_container.innerHTML = moment(window.selected_time, "HH:mm:ss").format("LT");
}

function setup_search_params() {
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
async function submit() {
    let button = document.getElementById('submit-button');
    button.disabled = true;
    let form = document.querySelector('#customer-form');
    if (!form.checkValidity()) {
        form.reportValidity();
        button.disabled = false;
        return;
    }
    let contact = get_form_data();
    let appointment =  frappe.call({
        method: 'erpnext.www.book_appointment.index.create_appointment',
        args: {
            'date': window.selected_date,
            'time': window.selected_time,
            'contact': contact,
            'tz':window.selected_timezone
        },
        callback: (response)=>{
            if (response.message.status == "Unverified") {
                frappe.show_alert(__("Please check your email to confirm the appointment"))
            } else {
                frappe.show_alert(__("Appointment Created Successfully"));
            }
            setTimeout(()=>{
                let redirect_url = "/";
                if (window.appointment_settings.success_redirect_url){
                    redirect_url += window.appointment_settings.success_redirect_url;
                }
                window.location.href = redirect_url;},5000)
        },
        error: (err)=>{
            frappe.show_alert(__("Something went wrong please try again"));
            button.disabled = false;
        }
    });
}

function get_form_data() {
    contact = {};
    let inputs = ['name', 'skype', 'number', 'notes', 'email'];
    inputs.forEach((id) => contact[id] = document.getElementById(`customer_${id}`).value)
    return contact
}

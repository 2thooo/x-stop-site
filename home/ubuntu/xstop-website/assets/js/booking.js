/**
 * X Stop Booking System
 * Handles the booking functionality for all X Stop activities
 */

// Activity data for all branches
const activityData = {
  'rak-entertainment': [
    { id: 'laser-tag', name: 'Laser Tag', price: 80, unit: 'per hour', description: 'Experience the thrill of laser tag in our state-of-the-art arena.' },
    { id: 'horror-escape', name: 'Horror Escape Room', price: 80, unit: 'per session', description: 'Can you solve the puzzles and escape our terrifying room?' },
    { id: 'kids-area', name: 'Kids Area + Face Drawing', price: 30, unit: 'per child', description: 'Fun activities and face painting for children of all ages.' },
    { id: 'smash-room', name: 'Smash Room', price: 50, unit: 'per session', description: 'Release your stress by smashing things in our safe environment.' },
    { id: 'billiard', name: 'Billiard', price: 40, unit: 'per hour', description: 'Enjoy a game of billiards on our professional tables.' },
    { id: 'playstation', name: 'PlayStation', price: 30, unit: 'per hour', description: 'Play the latest games on our PlayStation consoles.' },
    { id: 'pcs', name: 'PCs', price: 25, unit: 'per hour', description: 'High-performance gaming PCs with the latest games.' }
  ],
  'rifaa-entertainment': [
    { id: 'billiard-rifaa', name: 'Billiard', price: 40, unit: 'per hour', description: 'Enjoy a game of billiards on our professional tables.' },
    { id: 'playstation-rifaa', name: 'PlayStation', price: 30, unit: 'per hour', description: 'Play the latest games on our PlayStation consoles.' },
    { id: 'pcs-rifaa', name: 'PCs', price: 25, unit: 'per hour', description: 'High-performance gaming PCs with the latest games.' }
  ],
  'rak-cafe': [
    { id: 'cafe-visit', name: 'Cafe Visit', price: 0, unit: 'reservation only', description: 'Reserve a table at our RAK Mall cafe.' }
  ],
  'super-bowling-cafe': [
    { id: 'cafe-bowling-visit', name: 'Cafe Visit', price: 0, unit: 'reservation only', description: 'Reserve a table at our Super Bowling cafe.' }
  ],
  'hunted-cafe': [
    { id: 'hunted-cafe-visit', name: 'Cafe Visit', price: 0, unit: 'reservation only', description: 'Reserve a table at our themed Hunted X Cafe.' }
  ],
  'rak-flowers': [
    { id: 'flower-delivery', name: 'Flower Delivery', price: 0, unit: 'varies by selection', description: 'Order flowers for delivery in Ras Al Khaimah.' }
  ]
};

// Branch data
const branchData = {
  'rak-entertainment': {
    name: 'X Entertainment RAK Mall',
    address: 'RAK Mall, Ras Al Khaimah, UAE',
    hours: {
      'Monday - Thursday': '10:00 AM - 10:00 PM',
      'Friday - Saturday': '10:00 AM - 12:00 AM',
      'Sunday': '10:00 AM - 10:00 PM'
    }
  },
  'rifaa-entertainment': {
    name: 'X Entertainment Rifaa',
    address: 'Rifaa Area, Ras Al Khaimah, UAE',
    hours: {
      'Monday - Thursday': '10:00 AM - 10:00 PM',
      'Friday - Saturday': '10:00 AM - 12:00 AM',
      'Sunday': '10:00 AM - 10:00 PM'
    }
  },
  'rak-cafe': {
    name: 'X Cafe RAK Mall',
    address: 'RAK Mall, Ras Al Khaimah, UAE',
    hours: {
      'Monday - Thursday': '9:00 AM - 10:00 PM',
      'Friday - Saturday': '9:00 AM - 11:00 PM',
      'Sunday': '9:00 AM - 10:00 PM'
    }
  },
  'super-bowling-cafe': {
    name: 'X Cafe at Super Bowling',
    address: 'Super Bowling Center, Ras Al Khaimah, UAE',
    hours: {
      'Monday - Thursday': '10:00 AM - 10:00 PM',
      'Friday - Saturday': '10:00 AM - 12:00 AM',
      'Sunday': '10:00 AM - 10:00 PM'
    }
  },
  'hunted-cafe': {
    name: 'Hunted X Cafe',
    address: 'Downtown, Ras Al Khaimah, UAE',
    hours: {
      'Monday - Thursday': '5:00 PM - 12:00 AM',
      'Friday - Saturday': '5:00 PM - 2:00 AM',
      'Sunday': '5:00 PM - 12:00 AM'
    }
  },
  'rak-flowers': {
    name: 'X Flowers RAK Mall',
    address: 'RAK Mall, Ras Al Khaimah, UAE',
    hours: {
      'Monday - Thursday': '9:00 AM - 9:00 PM',
      'Friday - Saturday': '9:00 AM - 10:00 PM',
      'Sunday': '10:00 AM - 9:00 PM'
    }
  }
};

// Time slots available for booking
const timeSlots = [
  '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '2:00 PM', 
  '3:00 PM', '4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM', 
  '8:00 PM', '9:00 PM'
];

// Initialize booking system
function initBookingSystem() {
  // Get form elements
  const branchSelect = document.getElementById('branch');
  const activitySelect = document.getElementById('activity');
  const dateInput = document.getElementById('booking-date');
  const timeSelect = document.getElementById('booking-time');
  const peopleInput = document.getElementById('people-count');
  const bookingForm = document.getElementById('activity-booking-form');
  
  // Set minimum date to today
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const formattedToday = `${yyyy}-${mm}-${dd}`;
  dateInput.min = formattedToday;
  
  // Add event listeners
  if (branchSelect) {
    branchSelect.addEventListener('change', handleBranchChange);
  }
  
  if (activitySelect) {
    activitySelect.addEventListener('change', handleActivityChange);
  }
  
  if (dateInput) {
    dateInput.addEventListener('change', handleDateChange);
  }
  
  if (timeSelect) {
    timeSelect.addEventListener('change', handleTimeChange);
  }
  
  if (peopleInput) {
    peopleInput.addEventListener('change', handlePeopleChange);
  }
  
  if (bookingForm) {
    bookingForm.addEventListener('submit', handleBookingSubmit);
  }
  
  // Initialize branch select with default options
  populateBranchSelect();
}

// Populate branch select dropdown
function populateBranchSelect() {
  const branchSelect = document.getElementById('branch');
  if (!branchSelect) return;
  
  // Clear existing options
  branchSelect.innerHTML = '<option value="" disabled selected>Choose a branch</option>';
  
  // Add branch options
  Object.keys(branchData).forEach(branchId => {
    const option = document.createElement('option');
    option.value = branchId;
    option.textContent = branchData[branchId].name;
    branchSelect.appendChild(option);
  });
}

// Handle branch selection change
function handleBranchChange() {
  const branchValue = this.value;
  const activitySelect = document.getElementById('activity');
  
  // Clear existing options
  activitySelect.innerHTML = '<option value="" disabled selected>Choose an activity</option>';
  
  // Add new options based on selected branch
  if (branchValue && activityData[branchValue]) {
    activityData[branchValue].forEach(activity => {
      const option = document.createElement('option');
      option.value = activity.id;
      option.textContent = `${activity.name} - ${activity.price > 0 ? activity.price + ' DHS ' + activity.unit : activity.unit}`;
      activitySelect.appendChild(option);
    });
  }
  
  // Update summary
  updateSummary('branch', this.options[this.selectedIndex].text);
  updateSummary('activity', '-');
  updateSummary('price', '-');
  
  // Show branch details
  showBranchDetails(branchValue);
}

// Show branch details
function showBranchDetails(branchId) {
  const branchDetailsElement = document.getElementById('branch-details');
  if (!branchDetailsElement || !branchId || !branchData[branchId]) return;
  
  const branch = branchData[branchId];
  
  let hoursHtml = '';
  Object.entries(branch.hours).forEach(([day, hours]) => {
    hoursHtml += `<li><span>${day}</span> <span>${hours}</span></li>`;
  });
  
  branchDetailsElement.innerHTML = `
    <div class="branch-info">
      <h4>${branch.name}</h4>
      <p><i class="fas fa-map-marker-alt"></i> ${branch.address}</p>
      <div class="branch-hours">
        <h5>Opening Hours</h5>
        <ul class="hours-list">
          ${hoursHtml}
        </ul>
      </div>
    </div>
  `;
  
  branchDetailsElement.style.display = 'block';
}

// Handle activity selection change
function handleActivityChange() {
  const branchValue = document.getElementById('branch').value;
  const activityId = this.value;
  
  // Update summary
  updateSummary('activity', this.options[this.selectedIndex].text);
  
  // Show activity details
  showActivityDetails(branchValue, activityId);
  
  // Update total price
  updateTotalPrice();
}

// Show activity details
function showActivityDetails(branchId, activityId) {
  const activityDetailsElement = document.getElementById('activity-details');
  if (!activityDetailsElement || !branchId || !activityId) return;
  
  const activities = activityData[branchId] || [];
  const activity = activities.find(a => a.id === activityId);
  
  if (activity) {
    activityDetailsElement.innerHTML = `
      <div class="activity-info">
        <h4>${activity.name}</h4>
        <p>${activity.description}</p>
        <p class="activity-price">${activity.price > 0 ? activity.price + ' DHS ' + activity.unit : activity.unit}</p>
      </div>
    `;
    
    activityDetailsElement.style.display = 'block';
  } else {
    activityDetailsElement.style.display = 'none';
  }
}

// Handle date selection change
function handleDateChange() {
  const selectedDate = this.value;
  const timeSelect = document.getElementById('booking-time');
  
  // Clear existing options
  timeSelect.innerHTML = '<option value="" disabled selected>Choose a time slot</option>';
  
  // Add time slots
  const branchId = document.getElementById('branch').value;
  if (branchId) {
    // Filter time slots based on branch opening hours
    const filteredTimeSlots = filterTimeSlotsByBranch(branchId);
    
    filteredTimeSlots.forEach(slot => {
      const option = document.createElement('option');
      option.value = slot;
      option.textContent = slot;
      timeSelect.appendChild(option);
    });
  } else {
    // If no branch selected, show all time slots
    timeSlots.forEach(slot => {
      const option = document.createElement('option');
      option.value = slot;
      option.textContent = slot;
      timeSelect.appendChild(option);
    });
  }
  
  // Update summary
  updateSummary('date', formatDate(selectedDate));
  updateSummary('time', '-');
}

// Filter time slots based on branch opening hours
function filterTimeSlotsByBranch(branchId) {
  if (!branchId || !branchData[branchId]) return timeSlots;
  
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  // Determine which hours to use based on day of week
  let hoursKey;
  if (dayOfWeek === 0) {
    hoursKey = 'Sunday';
  } else if (dayOfWeek === 5 || dayOfWeek === 6) {
    hoursKey = 'Friday - Saturday';
  } else {
    hoursKey = 'Monday - Thursday';
  }
  
  // Get opening hours string
  const hoursString = branchData[branchId].hours[hoursKey] || branchData[branchId].hours['Monday - Thursday'];
  
  // Parse opening hours
  const [openingTime, closingTime] = parseHoursString(hoursString);
  
  // Filter time slots
  return timeSlots.filter(slot => {
    const slotTime = parseTimeString(slot);
    return slotTime >= openingTime && slotTime <= closingTime;
  });
}

// Parse hours string (e.g., "10:00 AM - 10:00 PM")
function parseHoursString(hoursString) {
  const [openingStr, closingStr] = hoursString.split(' - ');
  return [parseTimeString(openingStr), parseTimeString(closingStr)];
}

// Parse time string to minutes since midnight
function parseTimeString(timeStr) {
  const [time, period] = timeStr.split(' ');
  let [hours, minutes] = time.split(':').map(Number);
  
  if (period === 'PM' && hours < 12) {
    hours += 12;
  } else if (period === 'AM' && hours === 12) {
    hours = 0;
  }
  
  return hours * 60 + (minutes || 0);
}

// Format date for display
function formatDate(dateString) {
  if (!dateString) return '-';
  
  const date = new Date(dateString);
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

// Handle time selection change
function handleTimeChange() {
  // Update summary
  updateSummary('time', this.value);
}

// Handle people count change
function handlePeopleChange() {
  // Update summary
  updateSummary('people', this.value);
  
  // Update total price
  updateTotalPrice();
}

// Update booking summary
function updateSummary(field, value) {
  const summaryElement = document.getElementById(`summary-${field}`);
  if (summaryElement) {
    summaryElement.textContent = value;
  }
}

// Calculate and update total price
function updateTotalPrice() {
  const branchValue = document.getElementById('branch').value;
  const activityId = document.getElementById('activity').value;
  const peopleCount = parseInt(document.getElementById('people-count').value) || 0;
  
  let price = 0;
  let priceText = '-';
  
  if (branchValue && activityId && activityData[branchValue]) {
    const activity = activityData[branchValue].find(a => a.id === activityId);
    if (activity) {
      if (activity.price > 0) {
        price = activity.price * peopleCount;
        priceText = `${price} DHS`;
      } else {
        priceText = 'Reservation only';
      }
    }
  }
  
  updateSummary('price', priceText);
  return price;
}

// Handle booking form submission
function handleBookingSubmit(e) {
  e.preventDefault();
  
  // Validate form
  if (!validateBookingForm()) {
    return;
  }
  
  // Get form data
  const formData = {
    branch: document.getElementById('branch').value,
    branchName: document.getElementById('branch').options[document.getElementById('branch').selectedIndex].text,
    activity: document.getElementById('activity').value,
    activityName: document.getElementById('activity').options[document.getElementById('activity').selectedIndex].text,
    date: document.getElementById('booking-date').value,
    time: document.getElementById('booking-time').value,
    people: document.getElementById('people-count').value,
    name: document.getElementById('customer-name').value,
    email: document.getElementById('customer-email').value,
    phone: document.getElementById('customer-phone').value,
    specialRequests: document.getElementById('special-requests').value,
    price: updateTotalPrice()
  };
  
  // Save booking data to localStorage (in a real implementation, this would be sent to a server)
  saveBooking(formData);
  
  // Show confirmation
  showBookingConfirmation(formData);
}

// Validate booking form
function validateBookingForm() {
  const requiredFields = [
    { id: 'branch', name: 'Branch' },
    { id: 'activity', name: 'Activity' },
    { id: 'booking-date', name: 'Date' },
    { id: 'booking-time', name: 'Time' },
    { id: 'people-count', name: 'Number of People' },
    { id: 'customer-name', name: 'Name' },
    { id: 'customer-email', name: 'Email' },
    { id: 'customer-phone', name: 'Phone' }
  ];
  
  let isValid = true;
  let errorMessage = '';
  
  requiredFields.forEach(field => {
    const element = document.getElementById(field.id);
    if (!element.value) {
      isValid = false;
      errorMessage += `${field.name} is required.\n`;
      element.classList.add('error');
    } else {
      element.classList.remove('error');
    }
  });
  
  // Validate email format
  const emailElement = document.getElementById('customer-email');
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emailElement.value && !emailPattern.test(emailElement.value)) {
    isValid = false;
    errorMessage += 'Please enter a valid email address.\n';
    emailElement.classList.add('error');
  }
  
  // Validate phone format
  const phoneElement = document.getElementById('customer-phone');
  const phonePattern = /^[0-9+\s()-]{7,15}$/;
  if (phoneElement.value && !phonePattern.test(phoneElement.value)) {
    isValid = false;
    errorMessage += 'Please enter a valid phone number.\n';
    phoneElement.classList.add('error');
  }
  
  // Check terms agreement
  const termsElement = document.getElementById('terms-agreement');
  if (!termsElement.checked) {
    isValid = false;
    errorMessage += 'You must agree t
(Content truncated due to size limit. Use line ranges to read in chunks)
/**
 * X Stop Payment Integration
 * Handles payment processing for X Stop bookings
 */

// Payment methods supported
const paymentMethods = [
  { id: 'card', name: 'Credit Card', icon: 'fa-credit-card' },
  { id: 'paypal', name: 'PayPal', icon: 'fa-paypal' },
  { id: 'apple', name: 'Apple Pay', icon: 'fa-apple-pay' },
  { id: 'google', name: 'Google Pay', icon: 'fa-google-pay' }
];

// Initialize payment system
function initPaymentSystem() {
  // Get booking ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  const bookingId = urlParams.get('booking');
  
  if (!bookingId) {
    showNoBookingMessage();
    return;
  }
  
  // Get booking from localStorage
  const booking = getBookingById(bookingId);
  
  if (!booking) {
    showBookingNotFoundMessage(bookingId);
    return;
  }
  
  // Display booking details
  displayBookingDetails(booking);
  
  // Initialize payment method selection
  initPaymentMethodSelection();
  
  // Initialize payment form
  initPaymentForm(booking);
}

// Get booking by ID
function getBookingById(bookingId) {
  const bookings = JSON.parse(localStorage.getItem('xstop_bookings')) || [];
  return bookings.find(booking => booking.id === bookingId);
}

// Display booking details
function displayBookingDetails(booking) {
  const bookingDetailsList = document.getElementById('booking-details-list');
  if (!bookingDetailsList) return;
  
  bookingDetailsList.innerHTML = `
    <li><span>Booking ID:</span> <span>${booking.id}</span></li>
    <li><span>Branch:</span> <span>${booking.branchName}</span></li>
    <li><span>Activity:</span> <span>${booking.activityName}</span></li>
    <li><span>Date:</span> <span>${formatDate(booking.date)}</span></li>
    <li><span>Time:</span> <span>${booking.time}</span></li>
    <li><span>People:</span> <span>${booking.people}</span></li>
    <li><span>Total:</span> <span>${booking.price > 0 ? booking.price + ' DHS' : 'Reservation only'}</span></li>
  `;
}

// Initialize payment method selection
function initPaymentMethodSelection() {
  const paymentMethodOptions = document.querySelectorAll('.payment-method-option');
  if (!paymentMethodOptions.length) return;
  
  paymentMethodOptions.forEach(option => {
    option.addEventListener('click', () => {
      // Remove active class from all options
      paymentMethodOptions.forEach(opt => opt.classList.remove('active'));
      
      // Add active class to clicked option
      option.classList.add('active');
      
      // Show/hide payment forms based on selected method
      const method = option.getAttribute('data-method');
      showPaymentForm(method);
    });
  });
}

// Show payment form based on selected method
function showPaymentForm(method) {
  // Hide all payment forms
  const paymentForms = document.querySelectorAll('[id$="-payment-form"]');
  paymentForms.forEach(form => {
    form.style.display = 'none';
  });
  
  // Show selected payment form
  const selectedForm = document.getElementById(`${method}-payment-form`);
  if (selectedForm) {
    selectedForm.style.display = 'block';
  }
}

// Initialize payment form
function initPaymentForm(booking) {
  // Credit Card Form
  const cardForm = document.getElementById('card-payment-form');
  if (cardForm) {
    const cardNumberInput = document.getElementById('card-number');
    const cardExpiryInput = document.getElementById('card-expiry');
    const cardCvcInput = document.getElementById('card-cvc');
    
    // Format card number as user types
    if (cardNumberInput) {
      cardNumberInput.addEventListener('input', function() {
        this.value = formatCardNumber(this.value);
      });
    }
    
    // Format expiry date as user types
    if (cardExpiryInput) {
      cardExpiryInput.addEventListener('input', function() {
        this.value = formatExpiryDate(this.value);
      });
    }
    
    // Limit CVC to 3-4 digits
    if (cardCvcInput) {
      cardCvcInput.addEventListener('input', function() {
        this.value = this.value.replace(/\D/g, '').substring(0, 4);
      });
    }
  }
  
  // PayPal Form
  const paypalForm = document.getElementById('paypal-payment-form');
  
  // Apple Pay Form
  const applePayForm = document.getElementById('apple-payment-form');
  
  // Google Pay Form
  const googlePayForm = document.getElementById('google-payment-form');
  
  // Payment Button
  const btnPay = document.getElementById('btn-pay');
  if (btnPay) {
    btnPay.addEventListener('click', () => {
      processPayment(booking);
    });
  }
}

// Process payment
function processPayment(booking) {
  // Get selected payment method
  const selectedMethod = document.querySelector('.payment-method-option.active');
  if (!selectedMethod) {
    alert('Please select a payment method.');
    return;
  }
  
  const method = selectedMethod.getAttribute('data-method');
  
  // Validate form based on payment method
  if (!validatePaymentForm(method)) {
    return;
  }
  
  // Show loading state
  const btnPay = document.getElementById('btn-pay');
  if (btnPay) {
    btnPay.disabled = true;
    btnPay.textContent = 'Processing...';
  }
  
  // Simulate payment processing
  setTimeout(() => {
    // Update booking status
    updateBookingStatus(booking.id, 'paid');
    
    // Show success message
    showPaymentSuccess(booking);
  }, 2000);
}

// Validate payment form
function validatePaymentForm(method) {
  let isValid = true;
  let errorMessage = '';
  
  if (method === 'card') {
    // Validate card details
    const cardName = document.getElementById('card-name');
    const cardNumber = document.getElementById('card-number');
    const cardExpiry = document.getElementById('card-expiry');
    const cardCvc = document.getElementById('card-cvc');
    
    if (!cardName || !cardName.value.trim()) {
      isValid = false;
      errorMessage += 'Cardholder name is required.\n';
    }
    
    if (!cardNumber || !cardNumber.value.trim() || cardNumber.value.replace(/\s/g, '').length < 16) {
      isValid = false;
      errorMessage += 'Valid card number is required.\n';
    }
    
    if (!cardExpiry || !cardExpiry.value.trim() || !isValidExpiryDate(cardExpiry.value)) {
      isValid = false;
      errorMessage += 'Valid expiry date is required (MM/YY).\n';
    }
    
    if (!cardCvc || !cardCvc.value.trim() || cardCvc.value.length < 3) {
      isValid = false;
      errorMessage += 'Valid CVC is required.\n';
    }
  } else if (method === 'paypal') {
    // Validate PayPal details
    // In a real implementation, you would validate PayPal-specific fields
    isValid = true;
  } else if (method === 'apple') {
    // Validate Apple Pay details
    // In a real implementation, you would validate Apple Pay-specific fields
    isValid = true;
  } else if (method === 'google') {
    // Validate Google Pay details
    // In a real implementation, you would validate Google Pay-specific fields
    isValid = true;
  }
  
  if (!isValid) {
    alert('Please correct the following errors:\n\n' + errorMessage);
  }
  
  return isValid;
}

// Update booking status
function updateBookingStatus(bookingId, newStatus) {
  const bookings = JSON.parse(localStorage.getItem('xstop_bookings')) || [];
  const bookingIndex = bookings.findIndex(booking => booking.id === bookingId);
  
  if (bookingIndex !== -1) {
    bookings[bookingIndex].status = newStatus;
    bookings[bookingIndex].updatedAt = new Date().toISOString();
    
    localStorage.setItem('xstop_bookings', JSON.stringify(bookings));
    return true;
  }
  
  return false;
}

// Show payment success message
function showPaymentSuccess(booking) {
  const paymentContent = document.getElementById('payment-content');
  if (!paymentContent) return;
  
  paymentContent.innerHTML = `
    <div class="payment-success">
      <i class="fas fa-check-circle"></i>
      <h2>Payment Successful!</h2>
      <p>Your booking has been confirmed. A confirmation email has been sent to your email address.</p>
      <p>Booking ID: ${booking.id}</p>
      <div class="confirmation-details">
        <h4>Booking Details</h4>
        <ul>
          <li><span>Branch:</span> <span>${booking.branchName}</span></li>
          <li><span>Activity:</span> <span>${booking.activityName}</span></li>
          <li><span>Date:</span> <span>${formatDate(booking.date)}</span></li>
          <li><span>Time:</span> <span>${booking.time}</span></li>
          <li><span>People:</span> <span>${booking.people}</span></li>
          <li><span>Total:</span> <span>${booking.price > 0 ? booking.price + ' DHS' : 'Reservation only'}</span></li>
        </ul>
      </div>
      <div class="confirmation-actions">
        <a href="/" class="btn btn-book">Return to Homepage</a>
        <a href="/booking.html" class="btn btn-secondary">Make Another Booking</a>
      </div>
    </div>
  `;
}

// Show no booking message
function showNoBookingMessage() {
  const paymentContent = document.getElementById('payment-content');
  if (!paymentContent) return;
  
  paymentContent.innerHTML = `
    <div class="payment-success">
      <i class="fas fa-exclamation-circle"></i>
      <h2>No Booking Selected</h2>
      <p>Please select a booking to proceed with payment.</p>
      <a href="/booking.html" class="btn btn-book">Make a Booking</a>
    </div>
  `;
}

// Show booking not found message
function showBookingNotFoundMessage(bookingId) {
  const paymentContent = document.getElementById('payment-content');
  if (!paymentContent) return;
  
  paymentContent.innerHTML = `
    <div class="payment-success">
      <i class="fas fa-exclamation-circle"></i>
      <h2>Booking Not Found</h2>
      <p>We couldn't find the booking with ID: ${bookingId}.</p>
      <p>Please try again or contact customer support.</p>
      <a href="/booking.html" class="btn btn-book">Make a New Booking</a>
    </div>
  `;
}

// Format date for display
function formatDate(dateString) {
  if (!dateString) return '-';
  
  const date = new Date(dateString);
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

// Format card number with spaces
function formatCardNumber(value) {
  // Remove all non-digit characters
  const v = value.replace(/\D/g, '');
  
  // Add space after every 4 digits
  const matches = v.match(/\d{4,16}/g);
  const match = matches && matches[0] || '';
  const parts = [];
  
  for (let i = 0; i < match.length; i += 4) {
    parts.push(match.substring(i, i + 4));
  }
  
  if (parts.length) {
    return parts.join(' ');
  } else {
    return value;
  }
}

// Format expiry date (MM/YY)
function formatExpiryDate(value) {
  // Remove all non-digit characters
  const v = value.replace(/\D/g, '');
  
  if (v.length >= 3) {
    return v.substring(0, 2) + '/' + v.substring(2, 4);
  } else if (v.length === 2) {
    return v + '/';
  } else {
    return v;
  }
}

// Validate expiry date
function isValidExpiryDate(value) {
  // Check format
  if (!/^\d{2}\/\d{2}$/.test(value)) {
    return false;
  }
  
  const [month, year] = value.split('/').map(Number);
  
  // Check month is between 1 and 12
  if (month < 1 || month > 12) {
    return false;
  }
  
  // Get current date
  const now = new Date();
  const currentYear = now.getFullYear() % 100; // Get last 2 digits of year
  const currentMonth = now.getMonth() + 1; // January is 0
  
  // Check if card is expired
  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return false;
  }
  
  return true;
}

// Initialize payment system when DOM is loaded
document.addEventListener('DOMContentLoaded', initPaymentSystem);

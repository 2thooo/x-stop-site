// Enhanced payment processing for X Stop website
document.addEventListener('DOMContentLoaded', function() {
  // Get booking data from session storage
  const bookingDataString = sessionStorage.getItem('bookingData');
  
  if (!bookingDataString) {
    // No booking data found, redirect to booking page
    window.location.href = '/booking.html';
    return;
  }
  
  const bookingData = JSON.parse(bookingDataString);
  
  // Activity data with pricing and details
  const activityData = {
    'laser-tag': {
      name: 'Laser Tag',
      price: 80,
      unit: 'per hour'
    },
    'horror-escape': {
      name: 'Horror Escape Room',
      price: 80,
      unit: 'per session'
    },
    'kids-area': {
      name: 'Kids Area',
      price: 30,
      unit: 'per hour'
    },
    'face-painting': {
      name: 'Face Painting',
      price: 10,
      unit: 'per person'
    },
    'smash-room-small': {
      name: 'Smash Room - Small Package',
      price: 50,
      unit: 'per session'
    },
    'smash-room-medium': {
      name: 'Smash Room - Medium Package',
      price: 80,
      unit: 'per session'
    },
    'smash-room-large': {
      name: 'Smash Room - Large Package',
      price: 120,
      unit: 'per session'
    },
    'billiard': {
      name: 'Billiard',
      price: 40,
      unit: 'per hour'
    },
    'playstation': {
      name: 'PlayStation',
      price: 30,
      unit: 'per hour'
    },
    'pc-gaming': {
      name: 'PC Gaming',
      price: 25,
      unit: 'per hour'
    }
  };

  // Branch data
  const branchData = {
    'rak-mall': 'X Entertainment RAK Mall',
    'rifaa': 'X Entertainment Rifaa Branch',
    'sharjah': 'Expert Billiard - Sharjah (Al Majaz)',
    'super-bowling': 'X Café - Super Bowling Branch',
    'haunted-cafe': 'Haunted X Café - RAK'
  };

  // Populate booking summary
  function populateBookingSummary() {
    const summaryContainer = document.getElementById('booking-summary');
    if (!summaryContainer) return;
    
    const activity = activityData[bookingData.activity] || { name: 'Unknown Activity', price: 0, unit: '' };
    const branchName = branchData[bookingData.branch] || 'Unknown Branch';
    
    // Calculate price
    let price = activity.price;
    
    // For per-person activities like face painting, we multiply by people
    if (bookingData.activity === 'face-painting') {
      price *= bookingData['people-count'];
    }
    
    // Format date
    const bookingDate = new Date(bookingData['booking-date']);
    const formattedDate = bookingDate.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    
    // Create summary HTML
    summaryContainer.innerHTML = `
      <div class="summary-item">
        <span class="summary-label">Branch:</span>
        <span class="summary-value">${branchName}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Activity:</span>
        <span class="summary-value">${activity.name}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Date:</span>
        <span class="summary-value">${formattedDate}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Time:</span>
        <span class="summary-value">${bookingData['booking-time']}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">People:</span>
        <span class="summary-value">${bookingData['people-count']}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Name:</span>
        <span class="summary-value">${bookingData['customer-name']}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Email:</span>
        <span class="summary-value">${bookingData['customer-email']}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Phone:</span>
        <span class="summary-value">${bookingData['customer-phone']}</span>
      </div>
      <div class="summary-item total">
        <span class="summary-label">Total:</span>
        <span class="summary-value">${price} DHS</span>
      </div>
    `;
    
    // Store total price for payment processing
    document.getElementById('payment-amount').value = price;
  }

  // Initialize payment form
  function initPaymentForm() {
    const paymentForm = document.getElementById('payment-form');
    if (!paymentForm) return;
    
    // Payment method selection
    const paymentMethods = document.querySelectorAll('input[name="payment-method"]');
    const paymentSections = document.querySelectorAll('.payment-method-section');
    
    paymentMethods.forEach(method => {
      method.addEventListener('change', function() {
        // Hide all payment sections
        paymentSections.forEach(section => {
          section.style.display = 'none';
        });
        
        // Show selected payment section
        const selectedSection = document.getElementById(`${this.value}-section`);
        if (selectedSection) {
          selectedSection.style.display = 'block';
        }
      });
    });
    
    // Credit card form validation
    const cardNumberInput = document.getElementById('card-number');
    const cardExpiryInput = document.getElementById('card-expiry');
    const cardCvcInput = document.getElementById('card-cvc');
    
    if (cardNumberInput) {
      // Format card number with spaces
      cardNumberInput.addEventListener('input', function(e) {
        let value = e.target.value.replace(/\D/g, '');
        let formattedValue = '';
        
        for (let i = 0; i < value.length; i++) {
          if (i > 0 && i % 4 === 0) {
            formattedValue += ' ';
          }
          formattedValue += value[i];
        }
        
        e.target.value = formattedValue;
      });
    }
    
    if (cardExpiryInput) {
      // Format expiry date as MM/YY
      cardExpiryInput.addEventListener('input', function(e) {
        let value = e.target.value.replace(/\D/g, '');
        let formattedValue = '';
        
        if (value.length > 0) {
          formattedValue = value.substring(0, 2);
          
          if (value.length > 2) {
            formattedValue += '/' + value.substring(2, 4);
          }
        }
        
        e.target.value = formattedValue;
      });
    }
    
    // Form submission
    paymentForm.addEventListener('submit', function(e) {
      e.preventDefault();
      
      // Simulate payment processing
      const paymentButton = document.querySelector('button[type="submit"]');
      const originalText = paymentButton.textContent;
      
      paymentButton.disabled = true;
      paymentButton.textContent = 'Processing...';
      
      // Simulate API call with timeout
      setTimeout(function() {
        // Store confirmation data in session storage
        const confirmationData = {
          bookingData: bookingData,
          paymentMethod: document.querySelector('input[name="payment-method"]:checked').value,
          confirmationCode: generateConfirmationCode(),
          paymentDate: new Date().toISOString()
        };
        
        sessionStorage.setItem('confirmationData', JSON.stringify(confirmationData));
        
        // Redirect to confirmation page
        window.location.href = '/confirmation.html';
      }, 2000);
    });
  }

  // Generate random confirmation code
  function generateConfirmationCode() {
    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'XS-';
    
    for (let i = 0; i < 6; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    
    return code;
  }

  // Initialize the page
  populateBookingSummary();
  initPaymentForm();
});

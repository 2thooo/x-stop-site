// Enhanced booking system with branch-specific activity restrictions
document.addEventListener('DOMContentLoaded', function() {
  // Branch data with opening hours, activities, and other details
  const branchData = {
    'rak-mall': {
      name: 'X Entertainment RAK Mall',
      hours: 'Daily 10 AM – 2 AM',
      phone: '+971 55 749 0383',
      activities: ['laser-tag', 'horror-escape', 'kids-area', 'smash-room-small', 'smash-room-medium', 'smash-room-large', 'billiard', 'playstation', 'pc-gaming'],
      timeSlots: generateTimeSlots('10:00', '01:00')
    },
    'rifaa': {
      name: 'X Entertainment Rifaa Branch',
      hours: 'Daily 4 PM – 2 AM',
      phone: '+971 55 749 0383',
      activities: ['billiard', 'playstation', 'pc-gaming'],
      timeSlots: generateTimeSlots('16:00', '01:00')
    },
    'sharjah': {
      name: 'Expert Billiard - Sharjah (Al Majaz)',
      hours: 'Daily 10 AM – 12 AM',
      phone: '+971 55 749 0383',
      activities: ['billiard'],
      timeSlots: generateTimeSlots('10:00', '23:00')
    },
    'super-bowling': {
      name: 'X Café - Super Bowling Branch',
      hours: 'Daily 10 AM – 12 AM',
      phone: '+971 55 749 0383',
      activities: [],
      timeSlots: []
    },
    'haunted-cafe': {
      name: 'Haunted X Café - RAK',
      hours: 'Daily 4 PM – 2 AM',
      phone: '+971 55 749 0383',
      activities: [],
      timeSlots: []
    }
  };

  // Activity data with pricing and details
  const activityData = {
    'laser-tag': {
      name: 'Laser Tag',
      price: 80,
      unit: 'per hour',
      description: 'Experience the ultimate laser combat in our state-of-the-art arena!',
      minPeople: 2,
      maxPeople: 10
    },
    'horror-escape': {
      name: 'Horror Escape Room',
      price: 80,
      unit: 'per session',
      description: 'Can you solve the puzzles and escape the horror before time runs out?',
      minPeople: 2,
      maxPeople: 6,
      duration: 60 // minutes
    },
    'kids-area': {
      name: 'Kids Area',
      price: 30,
      unit: 'per hour',
      description: 'A safe and fun play area for children.',
      minPeople: 1,
      maxPeople: 15
    },
    'face-painting': {
      name: 'Face Painting',
      price: 10,
      unit: 'per person',
      description: 'Creative face painting for children.',
      minPeople: 1,
      maxPeople: 10
    },
    'smash-room-small': {
      name: 'Smash Room - Small Package',
      price: 50,
      unit: 'per session',
      description: 'Release your stress by smashing things! Small package includes 10 items.',
      minPeople: 1,
      maxPeople: 2,
      duration: 30 // minutes
    },
    'smash-room-medium': {
      name: 'Smash Room - Medium Package',
      price: 80,
      unit: 'per session',
      description: 'Release your stress by smashing things! Medium package includes 15 items.',
      minPeople: 1,
      maxPeople: 3,
      duration: 45 // minutes
    },
    'smash-room-large': {
      name: 'Smash Room - Large Package',
      price: 120,
      unit: 'per session',
      description: 'Release your stress by smashing things! Large package includes 25 items.',
      minPeople: 2,
      maxPeople: 4,
      duration: 60 // minutes
    },
    'billiard': {
      name: 'Billiard',
      price: 40,
      unit: 'per hour',
      description: 'Enjoy a game of billiards on our professional tables.',
      minPeople: 1,
      maxPeople: 4
    },
    'playstation': {
      name: 'PlayStation',
      price: 30,
      unit: 'per hour',
      description: 'Play the latest games on our PlayStation consoles.',
      minPeople: 1,
      maxPeople: 4
    },
    'pc-gaming': {
      name: 'PC Gaming',
      price: 25,
      unit: 'per hour',
      description: 'Experience high-performance gaming on our gaming PCs.',
      minPeople: 1,
      maxPeople: 1
    }
  };

  // Initialize form elements
  const branchSelect = document.getElementById('branch');
  const activitySelect = document.getElementById('activity');
  const dateInput = document.getElementById('booking-date');
  const timeSelect = document.getElementById('booking-time');
  const peopleInput = document.getElementById('people-count');
  const branchDetails = document.getElementById('branch-details');
  const activityDetails = document.getElementById('activity-details');
  
  // Summary elements
  const summaryBranch = document.getElementById('summary-branch');
  const summaryActivity = document.getElementById('summary-activity');
  const summaryDate = document.getElementById('summary-date');
  const summaryTime = document.getElementById('summary-time');
  const summaryPeople = document.getElementById('summary-people');
  const summaryPrice = document.getElementById('summary-price');

  // Populate branch select
  function populateBranches() {
    // Clear existing options except the first one
    while (branchSelect.options.length > 1) {
      branchSelect.remove(1);
    }

    // Add branch options
    for (const [id, branch] of Object.entries(branchData)) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = branch.name;
      branchSelect.appendChild(option);
    }
  }

  // Update available activities based on selected branch
  function updateActivities() {
    const branchId = branchSelect.value;
    
    // Clear existing options except the first one
    while (activitySelect.options.length > 1) {
      activitySelect.remove(1);
    }
    
    if (!branchId) return;
    
    const branch = branchData[branchId];
    
    // Show branch details
    branchDetails.innerHTML = `
      <div class="branch-info">
        <h4>${branch.name}</h4>
        <p><i class="fas fa-clock"></i> ${branch.hours}</p>
        <p><i class="fas fa-phone"></i> ${branch.phone}</p>
      </div>
    `;
    branchDetails.style.display = 'block';
    
    // If this is a café branch with no activities
    if (branch.activities.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No activities available at this branch';
      option.disabled = true;
      activitySelect.appendChild(option);
      activitySelect.disabled = true;
      
      // Show café message
      activityDetails.innerHTML = `
        <div class="activity-info">
          <h4>Café Location</h4>
          <p>This is a café location with no bookable activities. Please visit us to enjoy our menu!</p>
        </div>
      `;
      activityDetails.style.display = 'block';
      
      // Disable date, time, and people inputs
      dateInput.disabled = true;
      timeSelect.disabled = true;
      peopleInput.disabled = true;
      
      return;
    }
    
    // Enable activity select and related fields
    activitySelect.disabled = false;
    dateInput.disabled = false;
    timeSelect.disabled = false;
    peopleInput.disabled = false;
    
    // Add activity options
    branch.activities.forEach(activityId => {
      const activity = activityData[activityId];
      if (activity) {
        const option = document.createElement('option');
        option.value = activityId;
        option.textContent = `${activity.name} (${activity.price} DHS ${activity.unit})`;
        activitySelect.appendChild(option);
      }
    });
  }

  // Update activity details
  function updateActivityDetails() {
    const activityId = activitySelect.value;
    
    if (!activityId) {
      activityDetails.style.display = 'none';
      return;
    }
    
    const activity = activityData[activityId];
    
    // Show activity details
    activityDetails.innerHTML = `
      <div class="activity-info">
        <h4>${activity.name}</h4>
        <p>${activity.description}</p>
        <p class="activity-price">${activity.price} DHS ${activity.unit}</p>
        <p><i class="fas fa-users"></i> ${activity.minPeople} - ${activity.maxPeople} people</p>
        ${activity.duration ? `<p><i class="fas fa-clock"></i> ${activity.duration} minutes per session</p>` : ''}
      </div>
    `;
    activityDetails.style.display = 'block';
    
    // Update people input min/max
    peopleInput.min = activity.minPeople;
    peopleInput.max = activity.maxPeople;
    
    // Set default value if current value is outside range
    if (peopleInput.value < activity.minPeople) {
      peopleInput.value = activity.minPeople;
    } else if (peopleInput.value > activity.maxPeople) {
      peopleInput.value = activity.maxPeople;
    }
  }

  // Update time slots based on selected branch and date
  function updateTimeSlots() {
    const branchId = branchSelect.value;
    
    // Clear existing options except the first one
    while (timeSelect.options.length > 1) {
      timeSelect.remove(1);
    }
    
    if (!branchId || !dateInput.value) return;
    
    const branch = branchData[branchId];
    
    // If this is a café branch with no activities
    if (branch.activities.length === 0) {
      timeSelect.disabled = true;
      return;
    }
    
    // Enable time select
    timeSelect.disabled = false;
    
    // Add time slot options
    branch.timeSlots.forEach(slot => {
      const option = document.createElement('option');
      option.value = slot;
      option.textContent = slot;
      timeSelect.appendChild(option);
    });
  }

  // Update booking summary
  function updateSummary() {
    const branchId = branchSelect.value;
    const activityId = activitySelect.value;
    const date = dateInput.value;
    const time = timeSelect.value;
    const people = peopleInput.value;
    
    // Update summary fields
    summaryBranch.textContent = branchId ? branchData[branchId].name : '-';
    
    if (activityId && activityData[activityId]) {
      const activity = activityData[activityId];
      summaryActivity.textContent = activity.name;
      
      // Calculate price
      let price = activity.price;
      
      // For hourly activities, we don't multiply by people
      // For per-person activities like face painting, we multiply by people
      if (activityId === 'face-painting') {
        price *= people;
      }
      
      summaryPrice.textContent = `${price} DHS`;
    } else {
      summaryActivity.textContent = '-';
      summaryPrice.textContent = '-';
    }
    
    summaryDate.textContent = date ? formatDate(date) : '-';
    summaryTime.textContent = time || '-';
    summaryPeople.textContent = people || '-';
  }

  // Format date for display
  function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  // Generate time slots from start to end time
  function generateTimeSlots(startTime, endTime) {
    const slots = [];
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);
    
    let hour = startHour;
    let minute = startMinute;
    
    // Convert end time to 24-hour format if it's in the early morning
    const endHour24 = endHour < startHour ? endHour + 24 : endHour;
    
    while (hour < endHour24 || (hour === endHour24 && minute <= endMinute)) {
      const formattedHour = hour % 24;
      const period = formattedHour < 12 ? 'AM' : 'PM';
      const displayHour = formattedHour % 12 === 0 ? 12 : formattedHour % 12;
      
      slots.push(`${displayHour}:${minute.toString().padStart(2, '0')} ${period}`);
      
      // Increment by 30 minutes
      minute += 30;
      if (minute >= 60) {
        hour += 1;
        minute = 0;
      }
    }
    
    return slots;
  }

  // Set minimum date to today
  function setMinDate() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    
    dateInput.min = `${yyyy}-${mm}-${dd}`;
  }

  // Initialize the form
  function initForm() {
    populateBranches();
    setMinDate();
    
    // Set up event listeners
    branchSelect.addEventListener('change', function() {
      updateActivities();
      updateTimeSlots();
      updateSummary();
    });
    
    activitySelect.addEventListener('change', function() {
      updateActivityDetails();
      updateSummary();
    });
    
    dateInput.addEventListener('change', function() {
      updateTimeSlots();
      updateSummary();
    });
    
    timeSelect.addEventListener('change', updateSummary);
    peopleInput.addEventListener('change', updateSummary);
    
    // Check for URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const branchParam = urlParams.get('branch');
    const activityParam = urlParams.get('activity');
    
    // Set initial values if provided in URL
    if (branchParam && branchData[branchParam]) {
      branchSelect.value = branchParam;
      updateActivities();
      
      if (activityParam) {
        // Find the activity in the select options
        for (let i = 0; i < activitySelect.options.length; i++) {
          if (activitySelect.options[i].value === activityParam) {
            activitySelect.selectedIndex = i;
            updateActivityDetails();
            break;
          }
        }
      }
      
      updateTimeSlots();
      updateSummary();
    }
  }

  // Initialize the booking form
  initForm();
});

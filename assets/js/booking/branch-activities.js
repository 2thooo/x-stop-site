// Branch-specific activity restrictions for X Stop booking system
document.addEventListener('DOMContentLoaded', function() {
  initBranchActivityRestrictions();
});

// Function to initialize branch-activity restrictions
function initBranchActivityRestrictions() {
  const branchSelect = document.getElementById('branch-select');
  const activitySelect = document.getElementById('activity-select');
  
  if (!branchSelect || !activitySelect) return;
  
  // Define which activities are available at each branch
  const branchActivities = {
    'rak-mall': ['laser-tag', 'horror-escape', 'kids-area', 'smash-room', 'billiard', 'playstation', 'pc-gaming'],
    'rifaa': ['billiard', 'pc-gaming', 'playstation'],
    'sharjah': ['billiard'],
    'super-bowling': [], // Café only
    'haunted-cafe': []  // Café only
  };
  
  // Activity pricing by branch
  const activityPricing = {
    'laser-tag': { price: 80, unit: 'per hour' },
    'horror-escape': { price: 80, unit: 'per session' },
    'kids-area': { price: 30, unit: 'per hour' },
    'face-painting': { price: 10, unit: 'per session' },
    'smash-room-small': { price: 50, unit: 'per session' },
    'smash-room-medium': { price: 80, unit: 'per session' },
    'smash-room-large': { price: 120, unit: 'per session' },
    'billiard': { price: 40, unit: 'per hour' },
    'playstation': { price: 30, unit: 'per hour' },
    'pc-gaming': { price: 25, unit: 'per hour' }
  };
  
  // Update available activities when branch changes
  branchSelect.addEventListener('change', function() {
    const selectedBranch = this.value;
    updateAvailableActivities(selectedBranch);
  });
  
  // Initialize with default branch selection
  if (branchSelect.value) {
    updateAvailableActivities(branchSelect.value);
  }
  
  // Function to update available activities based on selected branch
  function updateAvailableActivities(branchId) {
    // Clear current options
    activitySelect.innerHTML = '<option value="">Select an activity</option>';
    
    // Get available activities for this branch
    const availableActivities = branchActivities[branchId] || [];
    
    if (availableActivities.length === 0) {
      // If no activities (café only), disable activity select
      activitySelect.disabled = true;
      activitySelect.innerHTML = '<option value="">No activities available at this branch</option>';
      
      // Show café message if applicable
      const cafeMessage = document.getElementById('cafe-message');
      if (cafeMessage) {
        cafeMessage.style.display = 'block';
      }
    } else {
      // Enable activity select and add options
      activitySelect.disabled = false;
      
      // Hide café message if applicable
      const cafeMessage = document.getElementById('cafe-message');
      if (cafeMessage) {
        cafeMessage.style.display = 'none';
      }
      
      // Special case for Smash Room (RAK Mall only)
      if (branchId === 'rak-mall' && availableActivities.includes('smash-room')) {
        // Add smash room package options
        const smashOption = document.createElement('optgroup');
        smashOption.label = 'Smash Room Packages';
        
        const smallPackage = document.createElement('option');
        smallPackage.value = 'smash-room-small';
        smallPackage.textContent = 'Smash Room - Small Pack (AED 50)';
        smashOption.appendChild(smallPackage);
        
        const mediumPackage = document.createElement('option');
        mediumPackage.value = 'smash-room-medium';
        mediumPackage.textContent = 'Smash Room - Medium Pack (AED 80)';
        smashOption.appendChild(mediumPackage);
        
        const largePackage = document.createElement('option');
        largePackage.value = 'smash-room-large';
        largePackage.textContent = 'Smash Room - Large Pack (AED 120)';
        smashOption.appendChild(largePackage);
        
        activitySelect.appendChild(smashOption);
        
        // Remove 'smash-room' from the array to avoid duplication
        const index = availableActivities.indexOf('smash-room');
        if (index > -1) {
          availableActivities.splice(index, 1);
        }
      }
      
      // Add other activities
      availableActivities.forEach(activity => {
        if (activity in activityPricing) {
          const option = document.createElement('option');
          option.value = activity;
          const pricing = activityPricing[activity];
          option.textContent = `${formatActivityName(activity)} (AED ${pricing.price} ${pricing.unit})`;
          activitySelect.appendChild(option);
        }
      });
      
      // Special case for Kids Area (add face painting option)
      if (branchId === 'rak-mall' && availableActivities.includes('kids-area')) {
        const kidsOption = document.createElement('option');
        kidsOption.value = 'face-painting';
        kidsOption.textContent = 'Face Painting (AED 10)';
        activitySelect.appendChild(kidsOption);
      }
    }
  }
  
  // Helper function to format activity names
  function formatActivityName(activityId) {
    const names = {
      'laser-tag': 'Laser Tag',
      'horror-escape': 'Horror Escape Room',
      'kids-area': 'Kids Area',
      'billiard': 'Billiard',
      'playstation': 'PlayStation',
      'pc-gaming': 'PC Gaming'
    };
    
    return names[activityId] || activityId;
  }
}

// Function to calculate booking price
function calculateBookingPrice(activityId, hours = 1) {
  const activityPricing = {
    'laser-tag': 80,
    'horror-escape': 80,
    'kids-area': 30,
    'face-painting': 10,
    'smash-room-small': 50,
    'smash-room-medium': 80,
    'smash-room-large': 120,
    'billiard': 40,
    'playstation': 30,
    'pc-gaming': 25
  };
  
  // Activities charged per session (not hourly)
  const perSessionActivities = ['horror-escape', 'face-painting', 'smash-room-small', 'smash-room-medium', 'smash-room-large'];
  
  if (activityId in activityPricing) {
    if (perSessionActivities.includes(activityId)) {
      // Per session activities don't multiply by hours
      return activityPricing[activityId];
    } else {
      // Hourly activities multiply by number of hours
      return activityPricing[activityId] * hours;
    }
  }
  
  return 0;
}

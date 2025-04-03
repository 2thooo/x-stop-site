// Google Maps integration for X Stop branches
document.addEventListener('DOMContentLoaded', function() {
  // Initialize maps when the branch pages load
  if (document.getElementById('branch-map')) {
    initBranchMap();
  }
});

// Function to initialize the map based on branch location
function initBranchMap() {
  const mapContainer = document.getElementById('branch-map');
  const branchId = mapContainer.getAttribute('data-branch-id');
  
  // Branch coordinates
  const branchLocations = {
    'rak-mall': { lat: 25.6741, lng: 55.7806, name: 'X Stop RAK Mall' },
    'rifaa': { lat: 25.6532, lng: 55.7527, name: 'X Entertainment Rifaa' },
    'sharjah': { lat: 25.3461, lng: 55.3845, name: 'Expert Billiard - Sharjah (Al Majaz)' },
    'super-bowling': { lat: 25.6741, lng: 55.7806, name: 'X Café - Super Bowling Branch' },
    'haunted-cafe': { lat: 25.6741, lng: 55.7806, name: 'Haunted X Café - RAK' }
  };
  
  // Get branch data
  const branch = branchLocations[branchId];
  
  if (branch) {
    // Create map centered on branch location
    const mapOptions = {
      center: { lat: branch.lat, lng: branch.lng },
      zoom: 15,
      mapTypeId: google.maps.MapTypeId.ROADMAP
    };
    
    const map = new google.maps.Map(mapContainer, mapOptions);
    
    // Add marker for branch location
    const marker = new google.maps.Marker({
      position: { lat: branch.lat, lng: branch.lng },
      map: map,
      title: branch.name,
      animation: google.maps.Animation.DROP
    });
    
    // Add info window
    const infoWindow = new google.maps.InfoWindow({
      content: `<div class="map-info-window"><h3>${branch.name}</h3><p>Click for directions</p></div>`
    });
    
    marker.addListener('click', function() {
      infoWindow.open(map, marker);
      // Open Google Maps directions in new tab
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${branch.lat},${branch.lng}`, '_blank');
    });
  }
}

// Function to load Google Maps API
function loadGoogleMapsAPI() {
  const script = document.createElement('script');
  script.src = 'https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&callback=initBranchMap';
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

// Enhanced navigation component for X Stop website
document.addEventListener('DOMContentLoaded', function() {
  initNavigation();
});

// Function to initialize enhanced navigation
function initNavigation() {
  // Add mobile menu toggle functionality
  const menuToggle = document.querySelector('.menu-toggle');
  const mobileMenu = document.querySelector('.mobile-menu');
  
  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', function() {
      mobileMenu.classList.toggle('active');
      this.classList.toggle('active');
    });
  }
  
  // Add dropdown functionality for branch navigation
  const branchDropdown = document.querySelector('.branch-dropdown');
  const branchDropdownContent = document.querySelector('.branch-dropdown-content');
  
  if (branchDropdown && branchDropdownContent) {
    branchDropdown.addEventListener('click', function(e) {
      e.preventDefault();
      branchDropdownContent.classList.toggle('show');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
      if (!e.target.matches('.branch-dropdown') && !e.target.closest('.branch-dropdown')) {
        if (branchDropdownContent.classList.contains('show')) {
          branchDropdownContent.classList.remove('show');
        }
      }
    });
  }
  
  // Highlight current page in navigation
  highlightCurrentPage();
}

// Function to highlight current page in navigation
function highlightCurrentPage() {
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('.nav-link');
  
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPath || 
        (currentPath.includes('/branches/') && href.includes('/branches/')) ||
        (currentPath.includes('/gallery') && href.includes('/gallery')) ||
        (currentPath.includes('/events') && href.includes('/events'))) {
      link.classList.add('active');
    }
  });
}

// Function to create branch navigation items dynamically
function createBranchNavItems() {
  const branchData = [
    { id: 'rak-mall', name: 'RAK Mall Branch', path: '/branches/rak-mall.html' },
    { id: 'rifaa', name: 'Rifaa Branch', path: '/branches/rifaa.html' },
    { id: 'sharjah', name: 'Expert Billiard - Sharjah', path: '/branches/sharjah.html' },
    { id: 'super-bowling', name: 'X Café - Super Bowling', path: '/branches/super-bowling.html' },
    { id: 'haunted-cafe', name: 'Haunted X Café', path: '/branches/haunted-cafe.html' }
  ];
  
  const branchDropdownContent = document.querySelector('.branch-dropdown-content');
  if (!branchDropdownContent) return;
  
  branchDropdownContent.innerHTML = '';
  
  branchData.forEach(branch => {
    const link = document.createElement('a');
    link.href = branch.path;
    link.textContent = branch.name;
    link.classList.add('branch-link');
    branchDropdownContent.appendChild(link);
  });
}

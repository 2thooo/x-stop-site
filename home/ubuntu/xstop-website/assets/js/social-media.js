// Social media integration for X Stop
document.addEventListener('DOMContentLoaded', function() {
  initSocialMediaLinks();
  initWhatsAppIntegration();
});

// Function to initialize social media links
function initSocialMediaLinks() {
  // Add click tracking to social media links
  const socialLinks = document.querySelectorAll('.social-media-link');
  
  socialLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      const platform = this.getAttribute('data-platform');
      console.log(`Clicked ${platform} link`);
      
      // For Instagram embeds, load content if needed
      if (platform === 'instagram' && this.hasAttribute('data-embed')) {
        loadInstagramEmbed(this.getAttribute('data-embed'));
      }
    });
  });
}

// Function to initialize WhatsApp integration
function initWhatsAppIntegration() {
  const whatsappButtons = document.querySelectorAll('.whatsapp-button');
  
  whatsappButtons.forEach(button => {
    button.addEventListener('click', function(e) {
      const phone = this.getAttribute('data-phone');
      const message = this.getAttribute('data-message') || '';
      
      // Open WhatsApp with pre-filled message
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
    });
  });
}

// Function to load Instagram embed
function loadInstagramEmbed(accountName) {
  const container = document.getElementById('instagram-feed');
  if (!container) return;
  
  // This is a placeholder for Instagram embed functionality
  // In a real implementation, you would use Instagram's API or embed code
  container.innerHTML = `<div class="instagram-placeholder">
    <h3>@${accountName}</h3>
    <p>Instagram feed loading...</p>
    <div class="instagram-grid">
      <div class="instagram-post placeholder"></div>
      <div class="instagram-post placeholder"></div>
      <div class="instagram-post placeholder"></div>
      <div class="instagram-post placeholder"></div>
    </div>
    <a href="https://www.instagram.com/${accountName}" target="_blank" class="view-more">View more on Instagram</a>
  </div>`;
}

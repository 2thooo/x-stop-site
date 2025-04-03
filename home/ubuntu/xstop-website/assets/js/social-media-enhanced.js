// Enhanced social media integration for X Stop website
document.addEventListener('DOMContentLoaded', function() {
  initSocialMediaLinks();
  initWhatsAppIntegration();
  initInstagramFeed();
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

  // Initialize WhatsApp order form if present
  const whatsappOrderForm = document.getElementById('whatsapp-order-form');
  if (whatsappOrderForm) {
    whatsappOrderForm.addEventListener('submit', function(e) {
      e.preventDefault();
      
      // Get form data
      const name = document.getElementById('whatsapp-name').value;
      const phone = document.getElementById('whatsapp-phone').value;
      const product = document.getElementById('whatsapp-product').value;
      const message = document.getElementById('whatsapp-message').value;
      
      // Create WhatsApp message
      const whatsappMessage = `Hello X Flower! I would like to place an order:\n\nName: ${name}\nPhone: ${phone}\nProduct: ${product}\nMessage: ${message}`;
      
      // Open WhatsApp with pre-filled message
      window.open(`https://wa.me/971547190018?text=${encodeURIComponent(whatsappMessage)}`, '_blank');
    });
  }
}

// Function to initialize Instagram feed
function initInstagramFeed() {
  const instagramFeeds = document.querySelectorAll('.instagram-feed');
  
  instagramFeeds.forEach(feed => {
    const account = feed.getAttribute('data-account');
    if (account) {
      loadInstagramEmbed(account, feed);
    }
  });
}

// Function to load Instagram embed
function loadInstagramEmbed(accountName, container) {
  if (!container) {
    container = document.querySelector(`.instagram-feed[data-account="${accountName}"]`);
    if (!container) return;
  }
  
  // This is a placeholder for Instagram embed functionality
  // In a real implementation, you would use Instagram's API or embed code
  container.innerHTML = `<div class="instagram-placeholder">
    <h3>@${accountName}</h3>
    <p>Recent posts from @${accountName}</p>
    <div class="instagram-grid">
      <div class="instagram-post placeholder">
        <div class="post-overlay">
          <i class="fas fa-heart"></i> 124
          <i class="fas fa-comment"></i> 8
        </div>
      </div>
      <div class="instagram-post placeholder">
        <div class="post-overlay">
          <i class="fas fa-heart"></i> 87
          <i class="fas fa-comment"></i> 5
        </div>
      </div>
      <div class="instagram-post placeholder">
        <div class="post-overlay">
          <i class="fas fa-heart"></i> 156
          <i class="fas fa-comment"></i> 12
        </div>
      </div>
      <div class="instagram-post placeholder">
        <div class="post-overlay">
          <i class="fas fa-heart"></i> 93
          <i class="fas fa-comment"></i> 7
        </div>
      </div>
    </div>
    <a href="https://www.instagram.com/${accountName}" target="_blank" class="view-more">
      <i class="fab fa-instagram"></i> Follow @${accountName} on Instagram
    </a>
  </div>`;
}

// Function to create social media sharing links
function createSocialShareLinks(container, shareData) {
  if (!container) return;
  
  const url = shareData.url || window.location.href;
  const title = shareData.title || document.title;
  const description = shareData.description || '';
  
  const shareHTML = `
    <div class="social-share-links">
      <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" 
         target="_blank" class="social-share-link" data-platform="facebook">
        <i class="fab fa-facebook-f"></i>
      </a>
      <a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}" 
         target="_blank" class="social-share-link" data-platform="twitter">
        <i class="fab fa-twitter"></i>
      </a>
      <a href="https://api.whatsapp.com/send?text=${encodeURIComponent(title + ' ' + url)}" 
         target="_blank" class="social-share-link" data-platform="whatsapp">
        <i class="fab fa-whatsapp"></i>
      </a>
      <a href="mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(description + '\n\n' + url)}" 
         class="social-share-link" data-platform="email">
        <i class="fas fa-envelope"></i>
      </a>
    </div>
  `;
  
  container.innerHTML = shareHTML;
}

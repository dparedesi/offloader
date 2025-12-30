// Dashboard logic
let dashboardData = null;
let targetSites = {};
let idleTabThreshold = 24; // hours

async function loadDashboard() {
  const loading = document.getElementById('loading');
  const dashboard = document.getElementById('dashboard');
  
  loading.style.display = 'block';
  dashboard.style.display = 'none';
  
  try {
    await telemetry.init();
    
    // Get target sites and idle threshold from storage
    const result = await chrome.storage.local.get(['targetSites', 'idleTabThreshold']);
    targetSites = result.targetSites || {
      sharepoint: true,
      slack: true,
      asana: true,
      quicksight: true
    };
    idleTabThreshold = result.idleTabThreshold || 24;
    
    // Set idle threshold input
    document.getElementById('idleThresholdInput').value = idleTabThreshold;
    
    // Get all data
    const data = await telemetry.exportAllData();
    dashboardData = data;
    
    // Calculate stats
    const stats = calculateStats(data);
    
    // Update UI
    updateStats(stats);
    updateTopDomains(stats.topDomains);
    updateMostActive(stats.mostActive);
    updateMostDiscarded(stats.mostDiscarded);
    updateRecentDiscards(data.discardEvents);
    updateTargetSitesList();
    
    loading.style.display = 'none';
    dashboard.style.display = 'block';
  } catch (error) {
    console.error('Error loading dashboard:', error);
    loading.textContent = 'Error loading data. Please try again.';
  }
}

function calculateStats(data) {
  const stats = {
    totalEvents: data.tabEvents.length,
    totalTabs: data.tabMetadata.length,
    totalDiscards: data.discardEvents.length,
    tabsDiscarded: 0,
    topDomains: {},
    mostActive: [],
    mostDiscarded: {}
  };
  
  // Count total tabs discarded
  data.discardEvents.forEach(event => {
    stats.tabsDiscarded += event.discardedCount;
    
    // Count discards by domain
    event.tabs.forEach(tab => {
      const domain = tab.domain;
      stats.mostDiscarded[domain] = (stats.mostDiscarded[domain] || 0) + 1;
    });
  });
  
  // Count tabs by domain
  data.tabMetadata.forEach(tab => {
    if (tab.domain) {
      stats.topDomains[tab.domain] = (stats.topDomains[tab.domain] || 0) + 1;
    }
  });
  
  // Get most active tabs (by activation count)
  stats.mostActive = data.tabMetadata
    .filter(tab => tab.activationCount > 0)
    .sort((a, b) => b.activationCount - a.activationCount)
    .slice(0, 10);
  
  return stats;
}

function updateStats(stats) {
  document.getElementById('totalEvents').textContent = stats.totalEvents.toLocaleString();
  document.getElementById('totalTabs').textContent = stats.totalTabs.toLocaleString();
  document.getElementById('totalDiscards').textContent = stats.totalDiscards.toLocaleString();
  document.getElementById('tabsDiscarded').textContent = stats.tabsDiscarded.toLocaleString();
}

function updateTopDomains(topDomains) {
  const container = document.getElementById('topDomains');
  const sorted = Object.entries(topDomains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  if (sorted.length === 0) {
    container.innerHTML = '<div class="list-item"><div class="list-label">No data yet</div></div>';
    return;
  }
  
  const max = sorted[0][1];
  
  container.innerHTML = sorted.map(([domain, count]) => `
    <div class="list-item">
      <div class="list-label">
        ${domain}
        <div class="bar">
          <div class="bar-fill" style="width: ${(count / max) * 100}%"></div>
        </div>
      </div>
      <div class="list-value">${count} tabs</div>
    </div>
  `).join('');
}

function updateMostActive(mostActive) {
  const container = document.getElementById('mostActive');
  
  if (mostActive.length === 0) {
    container.innerHTML = '<div class="list-item"><div class="list-label">No data yet</div></div>';
    return;
  }
  
  const max = mostActive[0].activationCount;
  
  container.innerHTML = mostActive.map(tab => {
    const domain = tab.domain || 'Unknown';
    const title = tab.title || 'Untitled';
    const activeTime = formatTime(tab.totalActiveTime || 0);
    
    return `
      <div class="list-item">
        <div class="list-label">
          <strong>${domain}</strong> - ${truncate(title, 50)}
          <div class="bar">
            <div class="bar-fill" style="width: ${(tab.activationCount / max) * 100}%"></div>
          </div>
          <div class="stat-detail">${activeTime} active time</div>
        </div>
        <div class="list-value">${tab.activationCount} views</div>
      </div>
    `;
  }).join('');
}

function updateMostDiscarded(mostDiscarded) {
  const container = document.getElementById('mostDiscarded');
  const sorted = Object.entries(mostDiscarded)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  if (sorted.length === 0) {
    container.innerHTML = '<div class="list-item"><div class="list-label">No discards yet</div></div>';
    return;
  }
  
  const max = sorted[0][1];
  
  container.innerHTML = sorted.map(([domain, count]) => `
    <div class="list-item">
      <div class="list-label">
        ${domain}
        <div class="bar">
          <div class="bar-fill" style="width: ${(count / max) * 100}%"></div>
        </div>
      </div>
      <div class="list-value">${count} times</div>
    </div>
  `).join('');
}

function updateRecentDiscards(discardEvents) {
  const container = document.getElementById('recentDiscards');
  const recent = discardEvents.slice(-10).reverse();
  
  if (recent.length === 0) {
    container.innerHTML = '<div class="list-item"><div class="list-label">No discards yet</div></div>';
    return;
  }
  
  container.innerHTML = recent.map(event => {
    const date = new Date(event.timestamp);
    const timeAgo = getTimeAgo(event.timestamp);
    
    return `
      <div class="list-item">
        <div class="list-label">
          ${date.toLocaleString()}
          <div class="stat-detail">${timeAgo}</div>
        </div>
        <div class="list-value">${event.discardedCount} tabs</div>
      </div>
    `;
  }).join('');
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

function updateTargetSitesList() {
  const container = document.getElementById('targetSitesList');
  
  const sites = Object.entries(targetSites).filter(([_, enabled]) => enabled);
  
  if (sites.length === 0) {
    container.innerHTML = '<div style="color: #5f6368; font-size: 14px;">No target sites configured</div>';
    return;
  }
  
  container.innerHTML = sites.map(([site, _]) => {
    const isBuiltIn = ['sharepoint', 'slack', 'asana', 'quicksight'].includes(site);
    return `
      <div class="site-item">
        <div>
          <span class="site-name">${site}</span>
          ${isBuiltIn ? '<span class="site-badge">built-in</span>' : '<span class="site-badge">custom</span>'}
        </div>
        <button class="remove-btn" data-site="${site}">Remove</button>
      </div>
    `;
  }).join('');
  
  // Add event listeners to remove buttons
  container.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const site = e.target.dataset.site;
      if (confirm(`Remove "${site}" from target sites?`)) {
        delete targetSites[site];
        await chrome.storage.local.set({ targetSites });
        
        // Notify background script
        chrome.runtime.sendMessage({ 
          action: 'updateTargetSites', 
          targetSites 
        });
        
        updateTargetSitesList();
      }
    });
  });
}

function truncate(str, length) {
  if (str.length <= length) return str;
  return str.substring(0, length) + '...';
}

// Event listeners
document.getElementById('refreshBtn').addEventListener('click', loadDashboard);

document.getElementById('exportBtn').addEventListener('click', () => {
  if (!dashboardData) return;
  
  const dataStr = JSON.stringify(dashboardData, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tab-telemetry-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('addSiteBtn').addEventListener('click', async () => {
  const input = document.getElementById('newSiteInput');
  const site = input.value.trim().toLowerCase();
  
  if (!site) {
    alert('Please enter a domain');
    return;
  }
  
  // Basic validation
  if (site.includes(' ')) {
    alert('Domain cannot contain spaces');
    return;
  }
  
  if (targetSites[site]) {
    alert('This site is already in the list');
    return;
  }
  
  // Add to target sites
  targetSites[site] = true;
  await chrome.storage.local.set({ targetSites });
  
  // Notify background script
  chrome.runtime.sendMessage({ 
    action: 'updateTargetSites', 
    targetSites 
  });
  
  input.value = '';
  updateTargetSitesList();
});

// Allow Enter key to add site
document.getElementById('newSiteInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('addSiteBtn').click();
  }
});

// Save idle threshold
document.getElementById('saveIdleBtn').addEventListener('click', async () => {
  const input = document.getElementById('idleThresholdInput');
  const threshold = parseInt(input.value);
  
  if (isNaN(threshold) || threshold < 0) {
    alert('Please enter a valid number (0 or greater)');
    return;
  }
  
  idleTabThreshold = threshold;
  await chrome.storage.local.set({ idleTabThreshold: threshold });
  
  // Notify background script
  chrome.runtime.sendMessage({ 
    action: 'updateIdleThreshold', 
    threshold: threshold 
  });
  
  alert(`Idle threshold updated to ${threshold} hours`);
});

// Load on page load
loadDashboard();

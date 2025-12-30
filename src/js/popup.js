// Load current state when popup opens
document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('autoToggle');
  const status = document.getElementById('status');
  const intervalSelect = document.getElementById('intervalSelect');
  const discardAllBtn = document.getElementById('discardAllBtn');
  const dashboardBtn = document.getElementById('dashboardBtn');
  const exportBtn = document.getElementById('exportBtn');
  const telemetryStats = document.getElementById('telemetryStats');
  const targetSitesContainer = document.getElementById('targetSitesContainer');
  
  // Get current state from storage
  const result = await chrome.storage.local.get([
    'autoDiscardEnabled',
    'targetSites',
    'discardInterval',
    'lastRun',
    'lastDiscardedCount'
  ]);
  
  const isEnabled = result.autoDiscardEnabled !== false; // Default to true
  let targetSites = result.targetSites || {
    sharepoint: true,
    slack: true,
    asana: true,
    quicksight: true
  };
  const interval = result.discardInterval || 10;
  
  toggle.checked = isEnabled;
  intervalSelect.value = interval;
  updateStatus(isEnabled, interval, result.lastRun, result.lastDiscardedCount);
  
  // Render target sites dynamically
  renderTargetSites(targetSites);
  
  // Load telemetry stats
  loadTelemetryStats();
  
  function renderTargetSites(sites) {
    const sortedSites = Object.keys(sites).sort();
    
    targetSitesContainer.innerHTML = sortedSites.map(site => {
      const displayName = site.charAt(0).toUpperCase() + site.slice(1);
      const isEnabled = sites[site];
      
      return `
        <div class="toggle-container" style="padding: 5px 0;">
          <span class="toggle-label" style="font-size: 13px;">${displayName}</span>
          <label class="switch">
            <input type="checkbox" class="site-toggle" data-site="${site}" ${isEnabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
      `;
    }).join('');
    
    // Add event listeners to all site toggles
    targetSitesContainer.querySelectorAll('.site-toggle').forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        const site = e.target.dataset.site;
        targetSites[site] = e.target.checked;
        await chrome.storage.local.set({ targetSites });
        
        // Notify background script
        chrome.runtime.sendMessage({ 
          action: 'updateTargetSites', 
          targetSites 
        });
      });
    });
  }
  
  // Dashboard button
  dashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'src/html/dashboard.html' });
  });
  
  // Discard all button
  discardAllBtn.addEventListener('click', async () => {
    if (!confirm('Discard all tabs except active and extensions?')) {
      return;
    }
    
    discardAllBtn.textContent = 'Discarding...';
    discardAllBtn.disabled = true;
    
    chrome.runtime.sendMessage({ action: 'discardAll' }, (response) => {
      if (response && response.success) {
        alert(`Discarded ${response.count} tabs`);
      }
      
      discardAllBtn.textContent = 'Discard All Tabs Now';
      discardAllBtn.disabled = false;
    });
  });
  
  // Listen for main toggle changes
  toggle.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    
    // Save state
    await chrome.storage.local.set({ autoDiscardEnabled: enabled });
    
    // Notify background script
    chrome.runtime.sendMessage({ 
      action: 'toggleAutoDiscard', 
      enabled: enabled 
    });
    
    updateStatus(enabled, interval);
  });
  
  // Listen for interval changes
  intervalSelect.addEventListener('change', async (e) => {
    const newInterval = parseInt(e.target.value);
    
    // Save state
    await chrome.storage.local.set({ discardInterval: newInterval });
    
    // Notify background script
    chrome.runtime.sendMessage({ 
      action: 'updateInterval', 
      interval: newInterval 
    });
    
    updateStatus(toggle.checked, newInterval);
  });
  
  // Export button
  exportBtn.addEventListener('click', async () => {
    exportBtn.textContent = 'Exporting...';
    exportBtn.disabled = true;
    
    chrome.runtime.sendMessage({ action: 'exportTelemetry' }, (response) => {
      if (response.success) {
        // Download as JSON file
        const dataStr = JSON.stringify(response.data, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tab-telemetry-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      
      exportBtn.textContent = 'Export Data (JSON)';
      exportBtn.disabled = false;
    });
  });
  
  function loadTelemetryStats() {
    chrome.runtime.sendMessage({ action: 'getTelemetryStats' }, (response) => {
      if (response.success) {
        const { totalEvents, totalTabs, totalDiscards } = response.stats;
        telemetryStats.textContent = `${totalEvents} events • ${totalTabs} tabs • ${totalDiscards} discards`;
      } else {
        telemetryStats.textContent = 'Stats unavailable';
      }
    });
  }
  
  function updateStatus(enabled, interval, lastRun, lastCount) {
    if (enabled) {
      let statusText = `Auto-discard is ON (every ${interval} min)`;
      if (lastRun && lastCount !== undefined) {
        const minutesAgo = Math.floor((Date.now() - lastRun) / 60000);
        statusText += `\nLast run: ${minutesAgo}m ago (${lastCount} tabs)`;
      }
      status.textContent = statusText;
      status.className = 'status status-on';
    } else {
      status.textContent = 'Auto-discard is OFF';
      status.className = 'status status-off';
    }
  }
});

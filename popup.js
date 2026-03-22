const DASH_URL = chrome.runtime.getURL('dashboard.html');

function showView(view) {
  document.getElementById('setup-view').style.display = view === 'setup' ? 'block' : 'none';
  document.getElementById('main-view').style.display = view === 'main' ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  // Check if team ID is configured
  chrome.storage.local.get(['cursorTeamId'], (data) => {
    if (data.cursorTeamId) {
      showView('main');
    } else {
      showView('setup');
    }
  });

  // Setup: save team ID
  document.getElementById('save-team-id').addEventListener('click', () => {
    const teamId = document.getElementById('team-id-input').value.trim();
    if (!teamId) {
      document.getElementById('status').textContent = 'Please enter a Team ID.';
      document.getElementById('status').style.display = 'block';
      return;
    }
    chrome.storage.local.set({ cursorTeamId: teamId }, () => {
      document.getElementById('status').style.display = 'none';
      showView('main');
    });
  });

  // Settings: change team ID
  document.getElementById('change-team-id').addEventListener('click', () => {
    chrome.storage.local.get(['cursorTeamId'], (data) => {
      document.getElementById('team-id-input').value = data.cursorTeamId || '';
      showView('setup');
    });
  });

  // Open dashboard
  document.getElementById('open-dash').addEventListener('click', () => {
    chrome.storage.local.set({
      cursorCsvData: null,
      cursorCsvUrl: null,
      cursorCsvTimestamp: null
    }, () => {
      chrome.tabs.create({ url: DASH_URL });
      window.close();
    });
  });

  // Re-open last report
  document.getElementById('open-last').addEventListener('click', () => {
    chrome.storage.local.get(['cursorCsvData', 'cursorCsvTimestamp'], (data) => {
      if (data.cursorCsvData) {
        chrome.tabs.create({ url: DASH_URL });
      } else {
        document.getElementById('status').textContent = 'No previous CSV found. Export one from Cursor first.';
        document.getElementById('status').style.display = 'block';
      }
      window.close();
    });
  });
});

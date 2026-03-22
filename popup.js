const DASH_URL = chrome.runtime.getURL('dashboard.html');

document.addEventListener('DOMContentLoaded', () => {
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

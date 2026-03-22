# Cursor Usage Dashboard

A Chrome extension that visualizes your Cursor team's usage with rich charts and breakdowns.

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the repository folder

## Setup

On first launch the extension will ask for your **Team ID**.

To find it:

1. Go to [cursor.com/dashboard](https://cursor.com/dashboard) and sign in
2. Click **Export CSV** — a green banner will appear with a download URL
3. Look at that URL — it contains `teamId=XXXXX`. Copy that number
4. Paste it into the extension popup when prompted

You can change the Team ID later by clicking **Change Team ID** in the popup.

## Usage

There are two ways to load your usage data:

- **Auto-detect** — Go to Cursor's dashboard and click "Export CSV". The extension detects the download and shows a button to open the spend dashboard.
- **Fetch Report** — Open the dashboard from the extension popup, pick a date range, and click "Fetch Report" to pull data directly from Cursor's API (you must be signed in to cursor.com).

Once loaded you can filter by developer, adjust the timezone, and export the dashboard as PNG or PDF.

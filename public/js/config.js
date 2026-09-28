/* ✏️  EDIT THIS FILE to update the church details shown on the website.
   Every value below is a SAMPLE — replace it with your real information. */
window.KGC = {
  name: 'Kingdom Glory Church',
  email: 'church@example.com',
  phone: '+233 00 000 0000',
  address: 'Add your church address here',
  liveUrl: '',                       // paste your YouTube / Facebook live link here
  social: { Facebook: '', YouTube: '', Instagram: '' },   // add full links; empty ones are hidden

  // Countdown target. day: 0 = Sunday … 6 = Saturday. Time is Ghana time (GMT).
  nextService: { title: 'Sunday Worship Service', day: 0, hour: 9, minute: 0 },

  schedule: [
    { tab: 'Sunday',  items: [['Prayer & Intercession', '7:30 AM'], ['Worship Service', '9:00 AM'], ['Children’s Church', '9:00 AM']] },
    { tab: 'Midweek', items: [['Bible Study', 'Wednesday · 6:00 PM'], ['Choir Rehearsal', 'Thursday · 5:30 PM']] },
    { tab: 'Prayer',  items: [['Morning Prayer', 'Daily · 5:30 AM'], ['Night Vigil', 'Last Friday · 10:00 PM']] }
  ]
};

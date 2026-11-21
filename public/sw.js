self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: event.data ? event.data.text() : "Notification" }; }
  const title = (data && data.title) || "Notification";
  const body = (data && data.body) || "";
  event.waitUntil(
    self.registration.showNotification(title, { body, icon: "/favicon.ico" })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = String(payload.title || "Municipality Location Request");
  const body = String(payload.body || "Open now to send your latest location.");
  const targetPath = String(payload.targetPath || "/live-tracking");
  const pingId = String(payload.pingId || "");

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: pingId ? `tracking-ping-${pingId}` : "tracking-ping",
      renotify: true,
      requireInteraction: true,
      data: {
        targetPath,
        pingId
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetPath = String(event.notification?.data?.targetPath || "/live-tracking");
  const targetUrl = new URL(targetPath, self.location.origin).toString();

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

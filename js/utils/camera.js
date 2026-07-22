export function showCameraFeedback(message) {
  const existing = document.getElementById("camera-feedback");
  if (existing) {
    existing.remove();
  }

  const feedback = document.createElement("p");
  feedback.id = "camera-feedback";
  feedback.className = "camera-feedback";
  feedback.textContent = message;
  document.body.appendChild(feedback);

  window.setTimeout(() => {
    feedback.remove();
  }, 4000);
}

export async function requestCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("unsupported");
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
  } catch {
    return navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
  }
}

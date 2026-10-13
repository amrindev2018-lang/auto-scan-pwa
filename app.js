
"use strict";

// ===============================
// ELEMENTS HTML
// ===============================

const camera = document.getElementById("camera");
const startBtn = document.getElementById("startCamera");
const stopBtn = document.getElementById("stopCamera");
const statusText = document.getElementById("status");

let cameraStream = null;

// ===============================
// START CAMERA
// ===============================

async function startCamera() {

    if (cameraStream) return;

    if (!navigator.mediaDevices?.getUserMedia) {
        statusText.textContent =
            "Caméra indisponible : HTTPS ou localhost requis.";
        return;
    }

    try {

        statusText.textContent = "Ouverture de la caméra...";
        startBtn.disabled = true;

        cameraStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });

        camera.srcObject = cameraStream;

        await camera.play();

        statusText.textContent = "Caméra active";
        stopBtn.disabled = false;

    } catch (error) {

        console.error("Erreur caméra :", error);

        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }

        camera.srcObject = null;

        if (error.name === "NotAllowedError") {
            statusText.textContent =
                "Permission caméra refusée.";
        } else if (error.name === "NotFoundError") {
            statusText.textContent =
                "Aucune caméra détectée.";
        } else if (error.name === "NotReadableError") {
            statusText.textContent =
                "Caméra utilisée par une autre application.";
        } else {
            statusText.textContent =
                "Erreur caméra : " + error.message;
        }

        startBtn.disabled = false;
        stopBtn.disabled = true;
    }
}

// ===============================
// STOP CAMERA
// ===============================

function stopCamera() {

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }

    camera.pause();
    camera.srcObject = null;

    startBtn.disabled = false;
    stopBtn.disabled = true;

    statusText.textContent = "Caméra arrêtée";
}

// ===============================
// EVENTS
// ===============================

startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);

// Libérer la caméra si la page est fermée
window.addEventListener("pagehide", stopCamera);

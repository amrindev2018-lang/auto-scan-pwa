
"use strict";

// ===============================
// ELEMENTS HTML
// ===============================

const camera = document.getElementById("camera");
const startBtn = document.getElementById("startCamera");
const stopBtn = document.getElementById("stopCamera");
const statusText = document.getElementById("status");
const plateList = document.getElementById("plateList");

// ===============================
// VARIABLES
// ===============================

let cameraStream = null;
let scanTimer = null;
let frameCount = 0;

const scanCanvas = document.createElement("canvas");
const scanContext = scanCanvas.getContext("2d");

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

        // Démarrer automatiquement la capture
        startAutoScan();

    } catch (error) {

        console.error("Erreur caméra :", error);

        stopAutoScan();

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
// CAPTURE AUTOMATIQUE DES FRAMES
// ===============================

function captureFrame() {

    if (
        !cameraStream ||
        camera.readyState < 2 ||
        !camera.videoWidth ||
        !camera.videoHeight
    ) {
        return;
    }

    // Réduire la taille pour le prototype
    const width = 640;
    const height = Math.round(
        camera.videoHeight * width / camera.videoWidth
    );

    scanCanvas.width = width;
    scanCanvas.height = height;

    scanContext.drawImage(
        camera,
        0,
        0,
        width,
        height
    );

    frameCount++;

    // Afficher uniquement la dernière image capturée
    const imageURL = scanCanvas.toDataURL(
        "image/jpeg",
        0.7
    );

    const preview = document.createElement("img");
    preview.src = imageURL;
    preview.alt = "Dernière frame capturée";
    preview.style.width = "100%";
    preview.style.marginTop = "10px";
    preview.style.borderRadius = "8px";

    plateList.replaceChildren();

    const counter = document.createElement("p");
    counter.textContent =
        "Frames capturées : " + frameCount;

    plateList.append(counter, preview);
}

// ===============================
// START AUTO SCAN
// ===============================

function startAutoScan() {

    if (scanTimer !== null) return;

    frameCount = 0;

    // Capture immédiate
    captureFrame();

    // Une frame par seconde pour le test
   scanTimer = setInterval(captureFrame, 200);
}

// ===============================
// STOP AUTO SCAN
// ===============================

function stopAutoScan() {

    if (scanTimer !== null) {
        clearInterval(scanTimer);
        scanTimer = null;
    }
}

// ===============================
// STOP CAMERA
// ===============================

function stopCamera() {

    stopAutoScan();

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

// Arrêter la caméra et la capture à la fermeture
window.addEventListener("pagehide", stopCamera);

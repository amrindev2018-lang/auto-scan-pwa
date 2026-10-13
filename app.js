
"use strict";

// =====================================
// ELEMENTS HTML
// =====================================

const camera = document.getElementById("camera");
const startBtn = document.getElementById("startCamera");
const stopBtn = document.getElementById("stopCamera");
const statusText = document.getElementById("status");
const plateList = document.getElementById("plateList");

// =====================================
// CONFIGURATION
// =====================================

const CAPTURE_INTERVAL = 200;      // 5 frames/seconde
const PREVIEW_INTERVAL = 1000;     // 1 aperçu/seconde
const DETECTION_INTERVAL = 1500;   // 1 détection / 1.5s

const MODEL_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.45;
const NMS_THRESHOLD = 0.45;

// =====================================
// VARIABLES
// =====================================

let cameraStream = null;
let scanTimer = null;

let frameCount = 0;
let detectionCount = 0;

let lastPreviewTime = 0;
let lastDetectionTime = 0;

let modelSession = null;
let modelLoading = null;
let detectionRunning = false;

let cameraVersion = 0;

// =====================================
// CANVAS
// =====================================

const scanCanvas = document.createElement("canvas");
const scanContext = scanCanvas.getContext("2d");

const modelCanvas = document.createElement("canvas");
modelCanvas.width = MODEL_SIZE;
modelCanvas.height = MODEL_SIZE;

const modelContext = modelCanvas.getContext(
    "2d",
    { willReadFrequently: true }
);

const previewCanvas = document.createElement("canvas");
const previewContext = previewCanvas.getContext("2d");

// =====================================
// LOAD ONNX MODEL
// =====================================

async function loadModel() {

    if (modelSession) {
        return modelSession;
    }

    if (modelLoading) {
        return modelLoading;
    }

    if (typeof ort === "undefined") {
        throw new Error("ONNX Runtime indisponible");
    }

    modelLoading = (async () => {

        ort.env.wasm.numThreads = 1;

        // Chemin absolu pour éviter libs/libs
        ort.env.wasm.wasmPaths =
            new URL("libs/", document.baseURI).href;

        const modelUrl = new URL(
            "models/best.onnx",
            document.baseURI
        ).href;

        const session = await ort.InferenceSession.create(
            modelUrl,
            {
                executionProviders: ["wasm"]
            }
        );

        console.log("MODEL LOADED SUCCESSFULLY");
        console.log("Inputs:", session.inputNames);
        console.log("Outputs:", session.outputNames);

        modelSession = session;

        return session;
    })();

    try {
        return await modelLoading;
    } finally {
        modelLoading = null;
    }
}

// =====================================
// START CAMERA
// =====================================

async function startCamera() {

    if (cameraStream || startBtn.disabled) return;

    if (!navigator.mediaDevices?.getUserMedia) {
        statusText.textContent =
            "Caméra indisponible : HTTPS requis.";
        return;
    }

    const currentVersion = ++cameraVersion;

    startBtn.disabled = true;

    try {

        statusText.textContent = "Ouverture caméra...";

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });

        if (currentVersion !== cameraVersion) {
            stream.getTracks().forEach(t => t.stop());
            return;
        }

        cameraStream = stream;
        camera.srcObject = stream;

        await camera.play();

        if (currentVersion !== cameraVersion) {
            return;
        }

        stopBtn.disabled = false;

        statusText.textContent =
            "Caméra active - Chargement IA...";

        startAutoScan();

        try {

            await loadModel();

            if (currentVersion === cameraVersion && cameraStream) {
                statusText.textContent =
                    "Caméra active - IA prête";
            }

        } catch (modelError) {

            console.error("MODEL ERROR:", modelError);

            if (currentVersion === cameraVersion && cameraStream) {
                statusText.textContent =
                    "Caméra active - Erreur IA";
            }
        }

    } catch (error) {

        console.error("Erreur caméra:", error);

        if (currentVersion === cameraVersion) {
            stopCamera();
            statusText.textContent =
                "Erreur caméra : " + error.message;
        }
    }
}

// =====================================
// CAPTURE AUTOMATIQUE
// =====================================

function captureFrame() {

    if (
        !cameraStream ||
        camera.readyState < 2 ||
        !camera.videoWidth ||
        !camera.videoHeight
    ) {
        return;
    }

    const width = 640;

    const height = Math.round(
        camera.videoHeight * width / camera.videoWidth
    );

    if (
        scanCanvas.width !== width ||
        scanCanvas.height !== height
    ) {
        scanCanvas.width = width;
        scanCanvas.height = height;
    }

    scanContext.drawImage(
        camera,
        0,
        0,
        width,
        height
    );

    frameCount++;

    const now = Date.now();

    // Détection IA
    if (
        modelSession &&
        !detectionRunning &&
        now - lastDetectionTime >= DETECTION_INTERVAL
    ) {

        lastDetectionTime = now;
        lastPreviewTime = now;

        detectPlates().catch(error => {
            console.error("DETECTION ERROR:", error);

            if (cameraStream) {
                statusText.textContent =
                    "Caméra active - Erreur détection";
            }
        });

        return;
    }

    // Aperçu normal lorsque l'IA charge
    if (
        !modelSession &&
        now - lastPreviewTime >= PREVIEW_INTERVAL
    ) {

        lastPreviewTime = now;

        showPreview(scanCanvas, []);
    }
}

// =====================================
// PREPROCESS IMAGE YOLO
// =====================================

function prepareImage(sourceCanvas) {

    const sourceWidth = sourceCanvas.width;
    const sourceHeight = sourceCanvas.height;

    const scale = Math.min(
        MODEL_SIZE / sourceWidth,
        MODEL_SIZE / sourceHeight
    );

    const resizedWidth = Math.round(sourceWidth * scale);
    const resizedHeight = Math.round(sourceHeight * scale);

    const padX = Math.floor(
        (MODEL_SIZE - resizedWidth) / 2
    );

    const padY = Math.floor(
        (MODEL_SIZE - resizedHeight) / 2
    );

    // Letterbox
    modelContext.fillStyle = "rgb(114,114,114)";
    modelContext.fillRect(
        0,
        0,
        MODEL_SIZE,
        MODEL_SIZE
    );

    modelContext.drawImage(
        sourceCanvas,
        padX,
        padY,
        resizedWidth,
        resizedHeight
    );

    const imageData = modelContext.getImageData(
        0,
        0,
        MODEL_SIZE,
        MODEL_SIZE
    );

    const pixels = imageData.data;
    const channelSize = MODEL_SIZE * MODEL_SIZE;

    const tensorData = new Float32Array(
        channelSize * 3
    );

    // RGB -> CHW, float32, 0..1
    for (let i = 0; i < channelSize; i++) {

        const pixelIndex = i * 4;

        tensorData[i] =
            pixels[pixelIndex] / 255;

        tensorData[channelSize + i] =
            pixels[pixelIndex + 1] / 255;

        tensorData[channelSize * 2 + i] =
            pixels[pixelIndex + 2] / 255;
    }

    const tensor = new ort.Tensor(
        "float32",
        tensorData,
        [1, 3, MODEL_SIZE, MODEL_SIZE]
    );

    return {
        tensor,
        scale,
        padX,
        padY,
        sourceWidth,
        sourceHeight
    };
}

// =====================================
// INTERSECTION OVER UNION
// =====================================

function calculateIoU(a, b) {

    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);

    const x2 = Math.min(
        a.x + a.width,
        b.x + b.width
    );

    const y2 = Math.min(
        a.y + a.height,
        b.y + b.height
    );

    const intersection =
        Math.max(0, x2 - x1) *
        Math.max(0, y2 - y1);

    const areaA = a.width * a.height;
    const areaB = b.width * b.height;

    const union = areaA + areaB - intersection;

    return union > 0 ? intersection / union : 0;
}

// =====================================
// NON MAXIMUM SUPPRESSION
// =====================================

function applyNMS(boxes) {

    const sorted = [...boxes].sort(
        (a, b) => b.confidence - a.confidence
    );

    const selected = [];

    while (sorted.length > 0 && selected.length < 20) {

        const best = sorted.shift();
        selected.push(best);

        for (let i = sorted.length - 1; i >= 0; i--) {

            if (
                calculateIoU(best, sorted[i]) >
                NMS_THRESHOLD
            ) {
                sorted.splice(i, 1);
            }
        }
    }

    return selected;
}

// =====================================
// PARSE YOLO OUTPUT
// Output attendu : [1, 5, 8400]
// =====================================

function parseDetections(output, info) {

    const data = output.data;
    const dims = output.dims;

    if (
        dims.length !== 3 ||
        dims[0] !== 1 ||
        dims[1] !== 5
    ) {
        throw new Error(
            "Format YOLO inattendu : " + JSON.stringify(dims)
        );
    }

    const count = dims[2];

    const boxes = [];

    for (let i = 0; i < count; i++) {

        // YOLOv8 mono-classe :
        // cx, cy, width, height, confidence

        const confidence = data[4 * count + i];

        if (
            !Number.isFinite(confidence) ||
            confidence < CONFIDENCE_THRESHOLD
        ) {
            continue;
        }

        const cx = data[i];
        const cy = data[count + i];
        const w = data[2 * count + i];
        const h = data[3 * count + i];

        if (
            !Number.isFinite(cx) ||
            !Number.isFinite(cy) ||
            !Number.isFinite(w) ||
            !Number.isFinite(h) ||
            w <= 0 ||
            h <= 0
        ) {
            continue;
        }

        // Supprimer padding et remettre à l'échelle
        const rawX =
            (cx - w / 2 - info.padX) / info.scale;

        const rawY =
            (cy - h / 2 - info.padY) / info.scale;

        const rawX2 =
            (cx + w / 2 - info.padX) / info.scale;

        const rawY2 =
            (cy + h / 2 - info.padY) / info.scale;

        const x1 = Math.max(0, rawX);
        const y1 = Math.max(0, rawY);

        const x2 = Math.min(
            info.sourceWidth,
            rawX2
        );

        const y2 = Math.min(
            info.sourceHeight,
            rawY2
        );

        if (x2 <= x1 || y2 <= y1) {
            continue;
        }

        boxes.push({
            x: x1,
            y: y1,
            width: x2 - x1,
            height: y2 - y1,
            confidence
        });
    }

    return applyNMS(boxes);
}

// =====================================
// DETECT PLATES WITH ONNX
// =====================================

async function detectPlates() {

    if (
        detectionRunning ||
        !modelSession ||
        !cameraStream
    ) {
        return;
    }

    detectionRunning = true;

    const version = cameraVersion;

    try {

        // Conserver la frame exacte analysée
        const frameCanvas = document.createElement("canvas");

        frameCanvas.width = scanCanvas.width;
        frameCanvas.height = scanCanvas.height;

        const frameContext = frameCanvas.getContext("2d");

        frameContext.drawImage(scanCanvas, 0, 0);

        const prepared = prepareImage(frameCanvas);

        const results = await modelSession.run({
            images: prepared.tensor
        });

        const output = results.output0;

        const boxes = parseDetections(
            output,
            prepared
        );

        if (
            version !== cameraVersion ||
            !cameraStream
        ) {
            return;
        }

        detectionCount++;

        showPreview(frameCanvas, boxes);

        console.log(
            "Détection:",
            detectionCount,
            "| Plaques:",
            boxes.length
        );

    } finally {

        detectionRunning = false;
    }
}

// =====================================
// PREVIEW + DETECTION BOXES
// =====================================

function showPreview(sourceCanvas, boxes) {

    previewCanvas.width = sourceCanvas.width;
    previewCanvas.height = sourceCanvas.height;

    previewContext.drawImage(
        sourceCanvas,
        0,
        0
    );

    // Rectangles verts sur les plaques
    previewContext.strokeStyle = "#00FF66";
    previewContext.lineWidth = 3;

    previewContext.fillStyle = "#00FF66";
    previewContext.font = "bold 15px Arial";

    boxes.forEach(box => {

        previewContext.strokeRect(
            box.x,
            box.y,
            box.width,
            box.height
        );

        const label =
            "PLAQUE " +
            Math.round(box.confidence * 100) +
            "%";

        const textY = Math.max(16, box.y - 6);

        previewContext.fillText(
            label,
            box.x,
            textY
        );
    });

    const image = document.createElement("img");

    image.src = previewCanvas.toDataURL(
        "image/jpeg",
        0.8
    );

    image.alt = "Détection automatique";
    image.style.width = "100%";
    image.style.marginTop = "10px";
    image.style.borderRadius = "8px";

    const counter = document.createElement("p");

    counter.textContent =
        "Frames capturées : " + frameCount;

    const detectionInfo = document.createElement("p");

    detectionInfo.textContent = modelSession
        ? "Plaques détectées : " + boxes.length
        : "Chargement du modèle IA...";

    plateList.replaceChildren(
        counter,
        detectionInfo,
        image
    );
}

// =====================================
// START AUTO SCAN
// =====================================

function startAutoScan() {

    if (scanTimer !== null) return;

    frameCount = 0;
    detectionCount = 0;

    lastPreviewTime = 0;
    lastDetectionTime = 0;

    captureFrame();

    scanTimer = setInterval(
        captureFrame,
        CAPTURE_INTERVAL
    );
}

// =====================================
// STOP AUTO SCAN
// =====================================

function stopAutoScan() {

    if (scanTimer !== null) {
        clearInterval(scanTimer);
        scanTimer = null;
    }
}

// =====================================
// STOP CAMERA
// =====================================

function stopCamera() {

    cameraVersion++;

    stopAutoScan();

    if (cameraStream) {

        cameraStream.getTracks().forEach(
            track => track.stop()
        );

        cameraStream = null;
    }

    camera.pause();
    camera.srcObject = null;

    startBtn.disabled = false;
    stopBtn.disabled = true;

    statusText.textContent = "Caméra arrêtée";
}

// =====================================
// EVENTS
// =====================================

startBtn.addEventListener(
    "click",
    startCamera
);

stopBtn.addEventListener(
    "click",
    stopCamera
);

window.addEventListener(
    "pagehide",
    stopCamera
);

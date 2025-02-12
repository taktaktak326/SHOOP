import {
    ChatbotUIWithFiles,
    MessageItemResponse,
    MessageItemResponseChunk,
    DocumentResponse,
} from "./dist/chatbotui-with-files.esm.min.js";


// Session

function generateSessionId() {
    return uuid.v4();
}

let sessionId = generateSessionId();

// Clear chat session.
document.addEventListener('DOMContentLoaded', function() {
    const clearButton = document.getElementById('clear-storage-button');
    clearButton.addEventListener('click', function() {
        alert('会話の履歴を削除します');
        sessionId = generateSessionId();
        const messagesDiv = document.querySelector("#messages");
        messagesDiv.innerHTML = '';
    });
});

// User data

let imageData = {};

// Document handling

document.addEventListener("DOMContentLoaded", () => {
    const modalHTML =
        '<div class="modal-content"><span class="close" id="closeBtn">❌</span><h2 id="documentTitle"></h2><div id="documentContent"></div></div>';
    const modal = document.createElement("div");
    modal.id = "documentModal";
    modal.innerHTML = modalHTML;
    document.body.appendChild(modal);
    const closeBtn = document.getElementById("closeBtn");

    closeBtn.addEventListener("click", () => {
        modal.style.display = "none";
    });

    window.addEventListener("click", (event) => {
        if (event.target === modal) {
            modal.style.display = "none";
        }
    });
});

function docCallback(...args) {
    const doc = args[0];
    const msg = document.querySelector(
        `div[data-chatbotui-message-id="${doc.messageID}"]`,
    );
    let docBox = msg.querySelector("div.doc-box");
    if (!docBox) {
        docBox = document.createElement("div");
        docBox.classList.add("doc-box");
    }
    const docDiv = document.createElement("div");
    docDiv.classList.add("doc-div");
    docDiv.innerText = doc.icon;
    docDiv.addEventListener("click", () => {
        const modal = document.getElementById("documentModal");
        const title = modal.querySelector("#documentTitle");
        const content = modal.querySelector("#documentContent");
        title.innerText = doc.title;
        content.innerText = doc.content;
        modal.style.display = "block";
    });
    docBox.appendChild(docDiv);
    msg.appendChild(docBox);
}


/**
 * Factory function to create an instance of a class from JSON.
 * @param {string} jsonString - The JSON object containing the class type and data.
 * @returns {Object} An instance of the appropriate class.
 */
function fromJSON(jsonString) {

    const json = JSON.parse(jsonString);

    switch (json.class) {
        case "MessageItemResponseChunk":
            return MessageItemResponseChunk.fromJSON(json.data);
        case "MessageItemResponse":
            return MessageItemResponse.fromJSON(json.data);
        case "DocumentResponse":
            return DocumentResponse.fromJSON(json.data);
        default:
            throw new Error(`Unknown response class: ${json.class}`);
    }
}

/**
 * Asynchronously streams and parses JSON lines from a ReadableStream.
 *
 * @param {ReadableStreamDefaultReader<Uint8Array>} body - The readable stream to read from.
 * @returns {AsyncGenerator<Object, void, unknown>} An async generator that yields parsed JSON objects.
 */
async function* streamResponse(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const {
            value,
            done
        } = await reader.read();
        if (done) {
            break;
        }
        const chunk = decoder.decode(value, {
            stream: true
        });
        buffer += chunk;
        let eolIndex;
        while ((eolIndex = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, eolIndex);
            buffer = buffer.slice(eolIndex + 1);
            if (line) {
                yield fromJSON(line);
            }
        }
    }
    if (buffer) {
        yield fromJSON(buffer);
    }
}

/**
 * Print processing error to user.
 * 
 * @param {string} message - Error message to be forwarded to the user.
 * @returns {MessageItemResponse} Response with error message.
 */
async function* forwardError(message) {
    yield new MessageItemResponse("text", message);
}

const stream = async (input) => {
    const content = input["chat-input"];

    let exchangeBucket = new FormData();

    const request = {
        sessionInfo: {
            session: sessionId,
            parameters: {
                queryType: "chat",
                url: window.location.href
            }
        },
        text: content,
        fulfillmentInfo: {
            tag: "chatbot-ui"
        }
    };

    exchangeBucket.append("session", sessionId);
    exchangeBucket.append("request", JSON.stringify(request));

    // Add image data to exchange bucket (and reset).
    for (const [key, value] of Object.entries(imageData)) {
        exchangeBucket.append("image", value);
    }
    // imageData = {}; // NOTE: not resetting mimics an image memory by sending each time all images of the chat history.

    try {
        const result = await fetch("https://api-xarvio-chat-jp.basf.com", {
            method: "POST",
            headers: {
                "X-Custom-Header": "Xarvio-JP-Chat",
            },
            body: exchangeBucket,
        });
        if (!result.ok) throw new Error(result);
        return streamResponse(result.body);

    } catch (error) {
        console.error(error);
        return forwardError("Chat request failed. Please retry or report if the issue persists.");
    }
};

// file

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB limit

// Attach file to input
const attachFileToInput = async (file) => {

    // Check whether file is image.
    if (!file.type.startsWith('image/')) {
        let errorMessage = "Uploaded file is not an image.";
        throw new Error(errorMessage)
    }

    // Check whether image type is supported.
    const allowedImageTypes = ["png", "jpeg", "jpg"]
    let isSupportedImageType = false;
    for (let type of allowedImageTypes) {
        if (file.name.endsWith(type)) {
            isSupportedImageType = true;
            break;
        }
    }
    if (!isSupportedImageType) {
        throw new Error("Uploaded image type must be one of: " + allowedImageTypes.join(", "))
    }

    if (file.size > MAX_FILE_SIZE) {
        let errorMessage = "Image exceeds maximum size of " + Math.round(MAX_FILE_SIZE / 1024 / 1024) + " MB.";
        throw new Error(errorMessage)
    }

    const fileID = uuid.v4()
    imageData[fileID] = file;

    return fileID;
};

// Remove file from input container
const detachFileFromInput = async (fileID) => {
    if (imageData.hasOwnProperty(fileID)) {
        delete imageData[fileID];
    }
};

// error callbacks

const showError = (msg) => {
    const alertDiv = document.createElement("div");
    alertDiv.classList.add("alert");
    const alertMsgDiv = document.createElement("div");
    alertMsgDiv.innerText = msg;
    alertDiv.appendChild(alertMsgDiv);
    chatbarDiv.appendChild(alertDiv);
    setTimeout(() => {
        alertDiv.remove();
    }, 3000);
};

function showErrorInUserInput(errorMessage) {

    let chatInputElement = document.querySelector('[data-chatbotui-type="ChatInput"]');
    let chatBarElement = document.querySelector('[data-chatbotui-type="ChatBar"]');

    let currentUserPrompt = chatInputElement.textContent;

    chatInputElement.textContent = errorMessage;
    chatBarElement.classList.add("error");

    // Restore user text
    setTimeout(() => {
        chatInputElement.textContent = currentUserPrompt;
        chatBarElement.classList.remove("error");
    }, 3000);
};

// ChatbotUI integration here

const msgDiv = document.querySelector("#messages");
const chatbarDiv = document.querySelector("#chatbar");

const chatbotUI = new ChatbotUIWithFiles(stream, attachFileToInput, detachFileFromInput)
    .withRender((content) => content)
    .withDocumentCallback(docCallback)
    .withErrorCallback(showErrorInUserInput)
    .attachTo(msgDiv, chatbarDiv);

chatbotUI.focus();
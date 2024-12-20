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
document.addEventListener('DOMContentLoaded', function () {
    const clearHistoryLink = document.getElementById('clear-history-link');

    clearHistoryLink.addEventListener('click', function (event) {
        event.preventDefault(); // デフォルトのリンク動作を無効化

        const userConfirmed = confirm('会話履歴を削除しますか？この操作は取り消せません。');
        if (userConfirmed) {
            sessionId = generateSessionId(); // 新しいセッションIDを生成
            const messagesDiv = document.querySelector("#messages");
            messagesDiv.innerHTML = ''; // チャット履歴をクリア
        }
    });
});




//document.addEventListener('DOMContentLoaded', async function () {
//    const messagesDiv = document.querySelector("#messages");

//    try {
//        console.log("初期メッセージをAPIからストリーミングで取得します...");

        // 初期メッセージ表示用の要素を作成
//        const assistantMessage = document.createElement("div");
//        assistantMessage.dataset.chatbotuiMessageRole = "assistant";
//        messagesDiv.appendChild(assistantMessage);

        // 初期メッセージ取得開始: ローディング状態
//        assistantMessage.classList.remove("no-loading"); // ローディングアイコンを一旦表示

//        const responseStream = await stream({
//            "chat-input": "今日は何の日ですか？挨拶は、お疲れ様です！と言ってください。ハルシネーションはしないでください。" // 初期メッセージ用リクエスト
//        });

        // ストリーミングデータを処理
//        for await (const chunk of responseStream) {
//            console.log("受信データ:", chunk);

//            if (chunk.content) {
                // リアルタイムにメッセージ内容を追加
//                assistantMessage.innerHTML += chunk.content;
//                assistantMessage.scrollIntoView({ behavior: "smooth" });
//            }
//        }

        // ストリーミング終了後: ローディングアイコンを非表示にする
//        assistantMessage.classList.add("no-loading");

//    } catch (error) {
//        console.error("初期メッセージの取得に失敗:", error);

//        const errorMessage = document.createElement("div");
//        errorMessage.dataset.chatbotuiMessageRole = "assistant";
//        errorMessage.innerText = "初期メッセージの取得に失敗しました。";
//        messagesDiv.appendChild(errorMessage);
//    }
// });



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

    // Add image data to exchange bucket and reset.
    for (const [key, value] of Object.entries(imageData)) {
        exchangeBucket.append("image", value);
    }
    imageData = {};

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

document.addEventListener('DOMContentLoaded', function () {
    const menuToggle = document.getElementById('menu-toggle');
    const menuContent = document.getElementById('menu-content');

    // メニューの表示・非表示を切り替える
    menuToggle.addEventListener('click', function (event) {
        event.stopPropagation(); // クリックイベントが親要素に伝播するのを防ぐ

        if (menuContent.classList.contains('visible')) {
            menuContent.classList.remove('visible');
            menuContent.classList.add('hidden');
        } else {
            menuContent.classList.add('visible');
            menuContent.classList.remove('hidden');
        }
    });

    // メニュー外をクリックすると閉じる
    document.addEventListener('click', function (event) {
        if (!menuToggle.contains(event.target) && !menuContent.contains(event.target)) {
            menuContent.classList.remove('visible');
            menuContent.classList.add('hidden');
        }
    });
});

// 新しいウィンドウでURLを開く
<script>
    function openPopup(url, title) {
        window.open(url, title, 'width=800,height=600,resizable=yes,scrollbars=yes');
        return false; // クリックイベントのデフォルト動作を無効化
    }
</script>


// ChatbotUI integration here

const msgDiv = document.querySelector("#messages");
const chatbarDiv = document.querySelector("#chatbar");

const chatbotUI = new ChatbotUIWithFiles(stream, attachFileToInput, detachFileFromInput, ["png"])
    .withRender((content) => content)
    .withDocumentCallback(docCallback)
    .withErrorCallback(showErrorInUserInput) // showError)
    .attachTo(msgDiv, chatbarDiv);

chatbotUI.focus();


/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Chat, GenerateContentResponse } from "@google/genai";

// Type declarations for global variables
declare global {
    // --- Speech API Types ---
    interface SpeechRecognitionEventMap {
        "audiostart": Event;
        "audioend": Event;
        "end": Event;
        "error": SpeechRecognitionErrorEvent;
        "nomatch": SpeechRecognitionEvent;
        "result": SpeechRecognitionEvent;
        "soundstart": Event;
        "soundend": Event;
        "speechstart": Event;
        "speechend": Event;
        "start": Event;
    }

    interface SpeechRecognition extends EventTarget {
        grammars: SpeechGrammarList;
        lang: string;
        continuous: boolean;
        interimResults: boolean;
        maxAlternatives: number;
        serviceURI: string; 

        onaudiostart: ((this: SpeechRecognition, ev: Event) => any) | null;
        onaudioend: ((this: SpeechRecognition, ev: Event) => any) | null;
        onend: ((this: SpeechRecognition, ev: Event) => any) | null;
        onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
        onnomatch: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
        onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
        onsoundstart: ((this: SpeechRecognition, ev: Event) => any) | null;
        onsoundend: ((this: SpeechRecognition, ev: Event) => any) | null;
        onspeechstart: ((this: SpeechRecognition, ev: Event) => any) | null;
        onspeechend: ((this: SpeechRecognition, ev: Event) => any) | null; 
        onstart: ((this: SpeechRecognition, ev: Event) => any) | null;

        abort(): void;
        start(): void;
        stop(): void;

        addEventListener<K extends keyof SpeechRecognitionEventMap>(type: K, listener: (this: SpeechRecognition, ev: SpeechRecognitionEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
        addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
        removeEventListener<K extends keyof SpeechRecognitionEventMap>(type: K, listener: (this: SpeechRecognition, ev: SpeechRecognitionEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
        removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
    }

    interface SpeechRecognitionErrorEvent extends Event {
        readonly error: string; 
        readonly message: string;
    }

    interface SpeechRecognitionEvent extends Event {
        readonly resultIndex: number;
        readonly results: SpeechRecognitionResultList;
    }

    interface SpeechRecognitionResultList {
        readonly length: number;
        item(index: number): SpeechRecognitionResult;
        [index: number]: SpeechRecognitionResult;
    }

    interface SpeechRecognitionResult {
        readonly length: number;
        item(index: number): SpeechRecognitionAlternative;
        [index: number]: SpeechRecognitionAlternative;
        readonly isFinal: boolean;
    }

    interface SpeechRecognitionAlternative {
        readonly transcript: string;
        readonly confidence: number;
    }

    interface SpeechGrammar {
        src: string;
        weight: number;
    }

    interface SpeechGrammarList {
        readonly length: number;
        item(index: number): SpeechGrammar;
        [index: number]: SpeechGrammar;
        addFromString(string: string, weight?: number): void;
        addFromURI(src: string, weight?: number): void;
    }

    var SpeechRecognition: {
        prototype: SpeechRecognition;
        new(): SpeechRecognition;
    };
    var webkitSpeechRecognition: {
        prototype: SpeechRecognition; 
        new(): SpeechRecognition;
    };
    
    namespace React {
      type ReactNode = any; 
      type Dispatch<A> = (value: A) => void;
      type SetStateAction<S> = S | ((prevState: S) => S);
      function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
      function useEffect(effect: () => (void | (() => void)), deps?: readonly any[]): void;
      interface RefObject<T> { current: T | null; }
      function useRef<T>(initialValue: T): RefObject<T>; 
      function useRef<T>(initialValue: T | null): RefObject<T | null>;

      interface ChangeEvent<T = Element> extends Event { currentTarget: EventTarget & T; target: EventTarget & T; }
      interface KeyboardEvent<T = Element> extends Event { key: string; preventDefault: () => void; shiftKey: boolean; }
    }

  interface Window {
    React: {
        createElement: (...args: any[]) => React.ReactNode;
        useState: typeof React.useState;
        useEffect: typeof React.useEffect;
        useRef: typeof React.useRef;
    };
    ReactDOM: {
        createRoot: (container: Element | DocumentFragment) => ({ render: (element: React.ReactNode) => void });
    };
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
    process?: {
      env: {
        API_KEY: string;
        [key: string]: string | undefined;
      };
    };
  }

  const htm: {
    bind: (createElement: any) => (...args: any[]) => any;
  };
}

export {};

const réalité = window.React;
const { useState, useEffect, useRef } = réalité;
const { createRoot } = window.ReactDOM;
const html = htm.bind(réalité.createElement);

const SpeechRecognitionGlobal = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition: SpeechRecognition | undefined;
if (SpeechRecognitionGlobal) {
    recognition = new SpeechRecognitionGlobal();
    recognition.continuous = false;
    recognition.lang = 'en-US'; // Changed to English
    recognition.interimResults = true; 
    recognition.maxAlternatives = 1;
} else {
    console.warn("Speech Recognition API is not supported in this browser.");
}

interface Message {
    id: string;
    sender: 'user' | 'ai' | 'system';
    text: string;
}

interface DashboardItem {
  id: string;
  title: string;
  recommendedPrompt: string;
}

const initialDashboardItems: DashboardItem[] = [
  { 
    id: 'field_management_initial', 
    title: 'Field Management', 
    recommendedPrompt: 'List the fields I am managing.' 
  },
  { 
    id: 'crop_records_initial', 
    title: 'Crop Records', 
    recommendedPrompt: 'Tell me about the recent growing status of the tomatoes.' 
  },
  { 
    id: 'work_tasks_initial', 
    title: 'Work Tasks', 
    recommendedPrompt: "What are today's work tasks?" 
  }
];

function App() {
    const [chat, setChat] = useState<Chat | null>(null);
    const [aiInstance, setAiInstance] = useState<GoogleGenAI | null>(null);
    const [messages, setMessages] = useState<Message[]>([
        { id: 'intro', sender: 'ai', text: "Hello, I'm Agri-chan! I'm here to help with your farming questions and records. Feel free to ask me anything." }
    ]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [dynamicDashboardItems, setDynamicDashboardItems] = useState<DashboardItem[]>(initialDashboardItems);
    const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
    const [isSharingScreen, setIsSharingScreen] = useState(false);
    const [screenShareStream, setScreenShareStream] = useState<MediaStream | null>(null);

    const chatHistoryRef = useRef<HTMLDivElement | null>(null);
    const chatInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        try {
            if (!process || !process.env || !process.env.API_KEY || process.env.API_KEY === "YOUR_API_KEY_HERE") {
                 console.error("API_KEY is not configured or is a placeholder.");
                 setError("API key is not configured correctly. Please contact the administrator.");
                return;
            }
            const genAI = new GoogleGenAI({ apiKey: process.env.API_KEY });
            setAiInstance(genAI); 

            const chatInstance = genAI.chats.create({
                model: 'gemini-2.5-flash-preview-04-17',
                config: {
                    systemInstruction: "You are a friendly farming support assistant. Your name is 'Agri-chan'. Please answer the user's questions in English. You have specialized knowledge of agriculture and strive to provide concrete and practical advice. If screen sharing starts, please prompt the user to describe the shared content.",
                },
            });
            setChat(chatInstance);
        } catch (err) {
            console.error("Failed to initialize AI Chat:", err);
            setError("Failed to initialize AI Chat. Please ensure your API key is set up correctly.");
        }
    }, []);

    useEffect(() => {
        if (chatHistoryRef.current) {
            chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
        }
    }, [messages]);

    const sendMessageRef = useRef(sendMessage);
    useEffect(() => {
        sendMessageRef.current = sendMessage;
    }, [sendMessage]);


    useEffect(() => {
        if (!recognition) return;

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            
            setInputValue(finalTranscript || interimTranscript);

            if (finalTranscript) {
                sendMessageRef.current(finalTranscript.trim());
            }
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            console.error('Speech recognition error:', event.error);
            setError(`Speech recognition error: ${event.error === 'no-speech' ? 'No speech detected.' : event.error === 'audio-capture' ? 'Microphone connection issue.' : event.error === 'not-allowed' ? 'Microphone access denied.' : 'An unknown error occurred.'}`);
            setIsRecording(false);
        };

        recognition.onend = () => {
            setIsRecording(false);
        };
    }, []); 


    const addSystemMessage = (text: string) => {
        setMessages(prevMessages => [...prevMessages, { id: Date.now() + '-system', sender: 'system', text }]);
    };
    
    const fetchAndUpdateDynamicQuickQuestions = async (lastAiResponseText: string) => {
        if (!aiInstance) {
            console.warn("AI instance for suggestions not available.");
            setDynamicDashboardItems(initialDashboardItems); 
            return;
        }
        setIsLoadingSuggestions(true);
        try {
            const suggestionPrompt = `
You are an AI assisting a user. The user is conversing with "Agri-chan," a farming assistant.
Agri-chan's last statement was:
"${lastAiResponseText}"

Based on Agri-chan's statement, suggest 2 or 3 relevant "Quick Questions" the user might ask next.
Provide each question as a short "title" and the actual "prompt" the user would ask.
Respond in the following JSON format, using the key names "suggestions", "title", and "prompt".

Example:
{
  "suggestions": [
    { "title": "More Details", "prompt": "Tell me more about that." },
    { "title": "Other Options", "prompt": "Are there any other options?" }
  ]
}
`;
            const response: GenerateContentResponse = await aiInstance.models.generateContent({
                model: 'gemini-2.5-flash-preview-04-17',
                contents: suggestionPrompt,
                config: {
                    responseMimeType: "application/json",
                }
            });

            let jsonStr = response.text.trim();
            const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
            const match = jsonStr.match(fenceRegex);
            if (match && match[2]) {
              jsonStr = match[2].trim();
            }

            const parsedData = JSON.parse(jsonStr);

            if (parsedData && Array.isArray(parsedData.suggestions)) {
                const newSuggestions: DashboardItem[] = parsedData.suggestions.map((sug: {title: string, prompt: string}, index: number) => ({
                    id: `dynamic-${Date.now()}-${index}`,
                    title: sug.title,
                    recommendedPrompt: sug.prompt
                }));
                if (newSuggestions.length > 0) {
                    setDynamicDashboardItems(newSuggestions);
                } else {
                     setDynamicDashboardItems(initialDashboardItems); 
                }
            } else {
                console.warn("Received suggestions in unexpected format:", parsedData);
                setDynamicDashboardItems(initialDashboardItems); 
            }

        } catch (err) {
            console.error("Error fetching or parsing dynamic quick questions:", err);
            setDynamicDashboardItems(initialDashboardItems); 
        } finally {
            setIsLoadingSuggestions(false);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
    };

    async function sendMessage(messageTextParam?: string) {
        const textToSend = messageTextParam || inputValue.trim();
        if (!textToSend || !chat || isLoading) return;

        const userMessage: Message = { id: Date.now() + '-user', sender: 'user', text: textToSend };
        setMessages(prevMessages => [...prevMessages, userMessage]);
        
        if (!messageTextParam) {
          setInputValue('');
        }


        setIsLoading(true);
        setError(null);

        try {
            const response: GenerateContentResponse = await chat.sendMessage({ message: userMessage.text });
            const aiMessageText = response.text;
            const aiMessage: Message = { id: Date.now() + '-ai', sender: 'ai', text: aiMessageText };
            setMessages(prevMessages => [...prevMessages, aiMessage]);
            
            await fetchAndUpdateDynamicQuickQuestions(aiMessageText);

        } catch (err) {
            console.error("Error sending message to AI:", err);
            setError("An error occurred while sending the message. Please try again later.");
            if (!messageTextParam) {
                setInputValue(textToSend); 
            }
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const toggleVoiceRecording = () => {
        if (!recognition) {
            setError("Your browser does not support speech recognition.");
            return;
        }
        if (isRecording) {
            recognition.stop();
        } else {
            setInputValue(''); 
            setError(null); 
            try {
                recognition.start();
                setIsRecording(true);
            } catch (err) {
                 console.error("Error starting recognition:", err);
                 setError("Failed to start speech recognition. Please check if your microphone is connected and access is permitted.");
                 setIsRecording(false);
            }
        }
    };
    
    const handleDashboardCardClick = (prompt: string) => {
      setInputValue(prompt); 
      sendMessage(prompt); 
      if (chatInputRef.current) {
        chatInputRef.current.focus();
      }
    };

    const stopScreenSharingEffects = () => {
        if (screenShareStream) {
            screenShareStream.getTracks().forEach(track => track.stop());
        }
        setIsSharingScreen(false);
        setScreenShareStream(null);
        addSystemMessage('Screen sharing stopped.');
    };

    const toggleScreenSharing = async () => {
        if (isSharingScreen) {
            stopScreenSharingEffects();
        } else {
            try {
                const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
                setScreenShareStream(stream);
                setIsSharingScreen(true);
                addSystemMessage('Screen sharing started. Please describe the shared content to Agri-chan.');

                if (stream.getVideoTracks().length > 0) {
                    const videoTrack = stream.getVideoTracks()[0];
                    videoTrack.onended = () => { 
                        stopScreenSharingEffects();
                    };
                }
            } catch (err) {
                console.error("Error starting screen sharing:", err);
                setError('Failed to start screen sharing. Permission may have been denied or it was cancelled.');
                setIsSharingScreen(false);
                setScreenShareStream(null);
            }
        }
    };

    const AvatarIcon = () => html`
        <span class="header-avatar-icon" role="img" aria-label="Avatar Icon">👩‍🌾</span>
    `;

    return html`
        <div class="app-container">
            <header class="header">
                <${AvatarIcon} />
                <h1 class="header-title">Farming Support AI Chat Dashboard</h1>
            </header>
            <main class="main-content">
                <aside class="left-pane">
                    <div class="avatar-display">
                        <img src="https://storage.googleapis.com/market_view_useritems/46638/images/kitty_20220608014936.gif" alt="Agri-chan Animated Avatar" />
                    </div>
                    <h2 class="avatar-name">Agri-chan</h2>
                    <section class="dashboard-section">
                        <h2 class="dashboard-title">
                            Quick Questions ${isLoadingSuggestions ? html`<span class="loading-suggestions-indicator">(Updating...)</span>` : ''}
                        </h2>
                        ${dynamicDashboardItems.map(item => html`
                            <div
                                key=${item.id}
                                class="dashboard-card clickable"
                                onClick=${() => handleDashboardCardClick(item.recommendedPrompt)}
                                onKeyPress=${(e: React.KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDashboardCardClick(item.recommendedPrompt); }}}
                                role="button"
                                tabindex="0"
                                aria-label="${item.title}: Ask \"${item.recommendedPrompt}\""
                            >
                                <h3>${item.title}</h3>
                                <p class="prompt-text">▶ "${item.recommendedPrompt}"</p>
                            </div>
                        `)}
                    </section>
                </aside>
                <section class="right-pane">
                    <div class="chat-history" ref=${chatHistoryRef} aria-live="polite" aria-atomic="false">
                        ${messages.map(msg => html`
                            <div key=${msg.id} class="chat-message ${msg.sender === 'user' ? 'user-message' : msg.sender === 'ai' ? 'ai-message' : 'system-message'}">
                                ${msg.sender !== 'system' && html`
                                    <span class="message-sender" style=${msg.sender === 'user' ? { display: 'none' } : {}}>${msg.sender === 'ai' ? 'Agri-chan' : 'You'}</span>
                                `}
                                ${msg.text.split('\n').map((line, i) => html`<p key=${i} style=${{margin: '0 0 5px 0'}}>${line}</p>`)}
                            </div>
                        `)}
                        ${isLoading && html`<div class="loading-indicator"><div class="spinner"></div><p>Agri-chan is thinking...</p></div>`}
                    </div>
                    ${error && html`<div class="error-message" role="alert">${error}</div>`}
                    <div class="chat-input-area">
                        <input
                            ref=${chatInputRef}
                            type="text"
                            class="chat-input"
                            value=${inputValue}
                            onChange=${handleInputChange}
                            onKeyPress=${handleKeyPress}
                            placeholder="Type a message or press the microphone button to talk..."
                            aria-label="Chat message input field"
                            disabled=${isLoading || isRecording}
                        />
                        <button
                            class="chat-button send-button"
                            onClick=${() => sendMessage()}
                            disabled=${isLoading || !inputValue.trim() || isRecording || isSharingScreen}
                            aria-label="Send"
                        >
                            Send
                        </button>
                        ${navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && html`
                            <button
                                class="chat-button screen-share-button ${isSharingScreen ? 'sharing' : ''}"
                                onClick=${toggleScreenSharing}
                                disabled=${isLoading || isRecording}
                                aria-label=${isSharingScreen ? "Stop Screen Share" : "Start Screen Share"}
                                title=${isSharingScreen ? "Stop Screen Share" : "Start Screen Share"}
                            >
                                ${isSharingScreen ? 'Stop' : '🖥️'}
                            </button>
                        `}
                        ${SpeechRecognitionGlobal && html`
                            <button
                                class="chat-button mic-button ${isRecording ? 'recording' : ''}"
                                onClick=${toggleVoiceRecording}
                                disabled=${isLoading || isSharingScreen} 
                                aria-label=${isRecording ? "Stop Recording" : "Start Voice Input"}
                                title=${isRecording ? "Stop Recording" : "Start Voice Input"}
                            >
                                ${isRecording ? 'Stop...' : '🎤'}
                            </button>
                        `}
                    </div>
                </section>
            </main>
        </div>
    `;
}

const rootElement = document.getElementById('root');
if (rootElement) {
    const root = createRoot(rootElement);
    root.render(html`<${App} />`);
} else {
    console.error("Root element not found.");
}

const displayApiKeyWarning = (message: string) => {
    console.warn(message);
    const appRoot = document.getElementById('root');
    if (appRoot) {
        const warningDiv = document.createElement('div');
        warningDiv.textContent = message;
        warningDiv.style.color = 'red';
        warningDiv.style.backgroundColor = 'yellow';
        warningDiv.style.padding = '10px';
        warningDiv.style.textAlign = 'center';
        warningDiv.style.fontWeight = 'bold';
        warningDiv.style.position = 'fixed';
        warningDiv.style.top = '0';
        warningDiv.style.left = '0';
        warningDiv.style.width = '100%';
        warningDiv.style.zIndex = '9999';
        if (!appRoot.querySelector('.dev-api-key-warning')) {
            warningDiv.className = 'dev-api-key-warning'; 
            appRoot.prepend(warningDiv);
        }
    }
};

if (typeof process === 'undefined' || typeof process.env === 'undefined') {
    window.process = window.process || { env: { API_KEY: "YOUR_API_KEY_HERE" } };
    window.process.env.API_KEY = window.process.env.API_KEY || "YOUR_API_KEY_HERE";
    const warningMsg = "Developer Warning: Global 'process.env.API_KEY' is undefined or inaccessible. " +
                       "Falling back to checking/setting 'window.process.env.API_KEY'. " +
                       "The application expects a global 'process.env.API_KEY'. " +
                       "Please ensure your actual API key is set correctly. " +
                       "In a production environment, 'process.env.API_KEY' should be set as an environment variable.";
    if (window.process.env.API_KEY === "YOUR_API_KEY_HERE") {
        displayApiKeyWarning(warningMsg);
    }
} else {
    if (process.env.API_KEY === "YOUR_API_KEY_HERE") {
        const warningMsg = "Warning: 'process.env.API_KEY' is set to a placeholder value. " +
                           "Please replace it with your actual Gemini API key. " +
                           "This should be configured via environment variables or your build process.";
        displayApiKeyWarning(warningMsg);
    }
}

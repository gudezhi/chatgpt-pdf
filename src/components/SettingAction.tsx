import { Accessor, createSignal, JSXElement, onMount, Setter, Show } from "solid-js"
import { toJpeg } from "html-to-image"
import { copyToClipboard, dateFormat } from "~/utils"
import type { ChatMessage } from "~/types"
import type { Setting } from "~/system"
import { PDFData, setPDFData } from "~/utils/global"

export default function SettingAction(props: {
  setting: Accessor<Setting>
  setSetting: Setter<Setting>
  clear: any
  reAnswer: any
  messaages: ChatMessage[]
}) {
  const [shown, setShown] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  const [showModal, setShowModal] = createSignal(false)
  const [progress, setProgress] = createSignal(0)
  const [pdfDocument,setPdfDocument] = createSignal(null)

  // 监听 pagesloaded 事件，并启用按钮，获得pdf
  onMount(() => {
    const button = document.querySelector("#processPdf");
    PDFViewerApplication.initializedPromise.then(function () {
      PDFViewerApplication.eventBus.on("pagesloaded", async function (e) {
        console.debug("pagesloaded");
        setPdfDocument(e.source.pdfDocument);
        button.disabled = false;
      })
    })
  });

  // 文本切片
  const slicePdfText = async () => {
    
    const pdfDoc = pdfDocument();
    const pdfID = pdfDoc.fingerprints[0];

    // 创建一个空数组用来存储提取的文本
    const texts = [];
    // from 1 to pagesCount,get every page's content
    for (let index = 1; index <= pdfDoc.numPages; index++) {
      const page = await pdfDoc.getPage(index);
      const text = await page.getTextContent();
      for (let i = 0; i < text.items.length; i++) {
        // console.debug(text.items[i].str);
        texts.push({ str: text.items[i].str, pageNum: index });
      }
    }

    // 创建一个空数组用来存储最终结果
    const result = [];
    // 定义一个变量用来存储当前正在处理的文本
    let currentText = "";
    // 定义一个索引变量用来遍历 texts 数组
    let index = 0;
    // 遍历 texts 数组
    while (index < texts.length) {
      // 将当前文本添加到 currentText 中
      currentText += texts[index].str + " ";
      
      if (currentText.length >= props.setting().newLength) {
        result.push({ str: currentText, pageNum: texts[index].pageNum });
        currentText = currentText.slice(-props.setting().overlap);
      }
      // 索引加一，继续遍历下一个元素
      index++;
    }
    // 如果 currentText 中还有剩余的字符，则将其添加到 result 数组中
    if (currentText) {
      result.push({ str: currentText, pageNum: texts[texts.length - 1].pageNum });
    }
    setPDFData({
      pdfID: pdfID,
      text: result
    });
  };



  async function processPdf() {
    // 禁用按钮
    const button = document.querySelector("#processPdf");
    button.disabled = true;
    setShowModal(true);
  
    // 处理PDF文本并切片
    await slicePdfText();
  
    // 将切片后的文本创建Embeddings
    const response = await fetch("/api/createEmbedding", {
      method: "POST",
      body: JSON.stringify({
        pdfID: PDFData().pdfID,
        messages: PDFData().text,
        maxSectionTokenLen: props.setting().maxSectionTokenLen,
        key: props.setting().openaiAPIKey,
        rebuildEmbeddings: props.setting().rebuildEmbeddings,
      }),
    });
  
    // 创建一个可读流来处理服务器发送的进度更新
    const reader = response?.body?.getReader();
    const decoder = new TextDecoder("utf-8");

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      const message = decoder.decode(value, { stream: true });
      // console.debug(message);

      // 处理消息，更新前端进度条
      setProgress(Number(message));
    }
    // 展示最后一次解析的进度信息
    setProgress(100);
  
    // 启用按钮
    button.disabled = false;
  }
  return (
    <div class="text-sm text-slate-7 dark:text-slate mb-2">
      <Show when={shown()}>
        <SettingItem icon="i-ri:lock-password-line" label="网站密码">
          <input
            type="password"
            value={props.setting().password}
            class="max-w-150px ml-1em px-1 text-slate-7 dark:text-slate rounded-sm bg-slate bg-op-15 focus:bg-op-20 focus:ring-0 focus:outline-none"
            onInput={e => {
              props.setSetting({
                ...props.setting(),
                password: (e.target as HTMLInputElement).value
              })
            }}
          />
        </SettingItem>
        <SettingItem icon="i-carbon:api" label="OpenAI API Key">
          <input
            type="password"
            value={props.setting().openaiAPIKey}
            class="max-w-150px ml-1em px-1 text-slate-7 dark:text-slate rounded-sm bg-slate bg-op-15 focus:bg-op-20 focus:ring-0 focus:outline-none"
            onInput={e => {
              props.setSetting({
                ...props.setting(),
                openaiAPIKey: (e.target as HTMLInputElement).value
              })
            }}
          />
        </SettingItem>
        <SettingItem icon="i-carbon:user-online" label="系统角色指令">
          <input
            type="text"
            value={props.setting().systemRule}
            class="text-ellipsis max-w-150px ml-1em px-1 text-slate-7 dark:text-slate rounded-sm bg-slate bg-op-15 focus:bg-op-20 focus:ring-0 focus:outline-none"
            onInput={e => {
              props.setSetting({
                ...props.setting(),
                systemRule: (e.target as HTMLInputElement).value
              })
            }}
          />
        </SettingItem>
        <SettingItem icon="i-carbon:data-enrichment" label="思维发散程度">
          <input
            type="range"
            min={0}
            max={100}
            value={String(props.setting().openaiAPITemperature)}
            class="max-w-150px w-full h-2 bg-slate bg-op-15 rounded-lg appearance-none cursor-pointer accent-slate"
            onInput={e => {
              props.setSetting({
                ...props.setting(),
                openaiAPITemperature: Number(
                  (e.target as HTMLInputElement).value
                )
              })
            }}
          />
        </SettingItem>
        <SettingItem
          icon="i-carbon:save-image"
          label="记录对话内容，刷新不会消失"
        >
          <label class="relative inline-flex items-center cursor-pointer ml-1">
            <input
              type="checkbox"
              checked={props.setting().archiveSession}
              class="sr-only peer"
              onChange={e => {
                props.setSetting({
                  ...props.setting(),
                  archiveSession: (e.target as HTMLInputElement).checked
                })
              }}
            />
            <div class="w-9 h-5 bg-slate bg-op-15 peer-focus:outline-none peer-focus:ring-0  rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-slate"></div>
          </label>
        </SettingItem>
        <SettingItem
          icon="i-carbon:3d-curve-auto-colon"
          label="开启连续对话，将加倍消耗 Token"
        >
          <label class="relative inline-flex items-center cursor-pointer ml-1">
            <input
              type="checkbox"
              checked={props.setting().continuousDialogue}
              class="sr-only peer"
              onChange={e => {
                props.setSetting({
                  ...props.setting(),
                  continuousDialogue: (e.target as HTMLInputElement).checked
                })
              }}
            />
            <div class="w-9 h-5 bg-slate bg-op-15 peer-focus:outline-none peer-focus:ring-0  rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-slate"></div>
          </label>
        </SettingItem>
        <SettingItem
          icon="i-carbon:number-9"
          label="依据PDF内容对话(需要预处理PDF)"
        >
          <label class="relative inline-flex items-center cursor-pointer ml-1">
            <input
              type="checkbox"
              checked={props.setting().chatWithPdf}
              class="sr-only peer"
              onChange={e => {
                props.setSetting({
                  ...props.setting(),
                  chatWithPdf: (e.target as HTMLInputElement).checked
                })
              }}
            />
            <div class="w-9 h-5 bg-slate bg-op-15 peer-focus:outline-none peer-focus:ring-0  rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-slate"></div>
          </label>
        </SettingItem>
        <SettingItem
          icon="i-carbon:number-9"
          label="重新生成Embeddings"
        >
          <label class="relative inline-flex items-center cursor-pointer ml-1">
            <input
              type="checkbox"
              checked={props.setting().rebuildEmbeddings}
              class="sr-only peer"
              onChange={e => {
                props.setSetting({
                  ...props.setting(),
                  rebuildEmbeddings: (e.target as HTMLInputElement).checked
                })
              }}
            />
            <div class="w-9 h-5 bg-slate bg-op-15 peer-focus:outline-none peer-focus:ring-0  rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-slate"></div>
          </label>
        </SettingItem>
        <SettingItem icon="i-carbon:number-9" label="关联信息最大token长度">
          <input
            type="number" 
            value={props.setting().maxSectionTokenLen}
            class="max-w-150px ml-1em px-1 text-slate-7 dark:text-slate rounded-sm bg-slate bg-op-15 focus:bg-op-20 ocus:ring-0 focus:outline-none"
            onInput={e => {
              props.setSetting({
                ...props.setting(),
                maxSectionTokenLen: Number((e.target as HTMLInputElement).value)
              })
            }}
          />
        </SettingItem>
        <SettingItem icon="i-carbon:number-9" label="PDF文本切片长度">
          <input
            type="number"
            value={props.setting().newLength}
            class="max-w-150px ml-1em px-1 text-slate-7 dark:text-slate rounded-sm bg-slate bg-op-15 focus:bg-op-20 ocus:ring-0 focus:outline-none"
            onInput={e => {
              props.setSetting({
                ...props.setting(),
                newLength: Number((e.target as HTMLInputElement).value)
              })
            }}
          />
        </SettingItem>
        <SettingItem icon="i-carbon:number-9" label="PDF文本切片重叠">
          <input
            type="number"
            value={props.setting().overlap}
            class="max-w-150px ml-1em px-1 text-slate-7 dark:text-slate rounded-sm bg-slate bg-op-15 focus:bg-op-20 ocus:ring-0 focus:outline-none"
            onInput={e => {
              props.setSetting({
                ...props.setting(),
                overlap: Number((e.target as HTMLInputElement).value)
              })
            }}
          />
        </SettingItem>
        <hr class="mt-2 bg-slate-5 bg-op-15 border-none h-1px"></hr>
      </Show>
      <Show when={showModal()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div class="bg-white rounded-md p-6">
            <h3 class="text-lg font-bold mb-4">Processing PDF</h3>
            <div class="relative w-full h-4 bg-gray-200 rounded">
              <div
                class="absolute top-0 left-0 h-4 bg-blue-500 rounded"
                style={`width: ${progress()}%`}
              ></div>
            </div>
            <p class="text-center mt-4">
              {progress() < 100
                ? "Please wait while we process your PDF..."
                : "PDF processing complete!"}
            </p>
            <button
              class="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none"
              onClick={() => {
                setShowModal(false);
                if (progress() === 100) {
                  setProgress(0);
                }
              }}
            >
              {progress() < 100 ? "Cancel" : "Close"}
            </button>
          </div>
        </div>
      </Show>
      <div class="mt-2 flex items-center justify-between">
        <div class="flex">
          <ActionItem
            onClick={() => {
              setShown(!shown())
            }}
            icon="i-carbon:settings"
            label="设置"
          />
          <ActionItem
            onClick={processPdf}
            icon="i-carbon:document-pdf"
            label="处理PDF"
            id="processPdf"
          />
        </div>
        <div class="flex">
          <ActionItem
            onClick={exportJpg}
            icon="i-carbon:image"
            label="导出图片"
          />
          <ActionItem
            label="导出 Markdown"
            onClick={async () => {
              await exportMD(props.messaages)
              setCopied(true)
              setTimeout(() => setCopied(false), 1000)
            }}
            icon={
              copied()
                ? "i-ri:check-fill dark:text-yellow text-yellow-6"
                : "i-ri:markdown-line"
            }
          />
          <ActionItem
            onClick={props.reAnswer}
            icon="i-carbon:reset"
            label="重新回答"
          />
          <ActionItem
            onClick={props.clear}
            icon="i-carbon:trash-can"
            label="清空对话"
          />
        </div>
      </div>
    </div>
  )
}

function SettingItem(props: {
  children: JSXElement
  icon: string
  label: string
}) {
  return (
    <div class="flex items-center p-1 justify-between hover:bg-slate hover:bg-op-10 rounded">
      <div class="flex items-center">
        <button class={props.icon} />
        <span ml-1>{props.label}</span>
      </div>
      {props.children}
    </div>
  )
}

function ActionItem(props: { onClick: any; icon: string; label?: string, id?:string }) {
  return (
    <div
      class="flex items-center cursor-pointer mx-1 p-2 hover:bg-slate hover:bg-op-10 rounded text-1.2em"
      onClick={props.onClick}
    >
      <button class={props.icon} title={props.label} id={props.id}/>
    </div>
  )
}

function exportJpg() {
  toJpeg(document.querySelector("#message-container") as HTMLElement, {}).then(
    url => {
      const a = document.createElement("a")
      a.href = url
      a.download = `ChatGPT-${dateFormat(new Date(), "HH-MM-SS")}.jpg`
      a.click()
    }
  )
}

async function exportMD(messages: ChatMessage[]) {
  const role = {
    system: "系统",
    user: "我",
    assistant: "ChatGPT"
  }
  await copyToClipboard(
    messages
      .map(k => {
        return `### ${role[k.role]}\n\n${k.content.trim()}`
      })
      .join("\n\n\n\n")
  )
}


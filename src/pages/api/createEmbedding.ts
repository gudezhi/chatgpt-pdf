import cosineSimilarity from "compute-cosine-similarity";
import { Configuration, OpenAIApi } from "openai";
import type { APIRoute } from "astro";
import * as fs from "fs";
import * as Papa from "papaparse";
import * as cliProgress from 'cli-progress';


export const PDFDataWithEmbedding: { [key: string]: Contexts } = {}

const MAX_SECTION_TOKEN_LEN = 500;
const SEPARATOR = "\n* ";
const separatorLen = 3

const localEnv = import.meta.env.OPENAI_API_KEY;
const vercelEnv = process.env.OPENAI_API_KEY;
const apiKeys = ((localEnv || vercelEnv)?.split(/\s*\|\s*/) ?? []).filter(Boolean);

// 存储网页pdf内容
interface DataFrame {
  str: string;
  pageNum: number;
  index: number;
}

// 含embeddings的pdf内容，也用于持久化
interface Contexts {
  [key: string]: {
    arr: number[]; // embeddings
    content: string; // 内容
    pageNum: number; // pdf页数
    content_tokens: number; // tokens长度
    content_length: number; // 字符串长度
  };
}

type DocumentSimilarities = [number, string][];

export const post: APIRoute = async (context) => {
  const body = await context.request.json();
  const apiKey = apiKeys.length ? apiKeys[Math.floor(Math.random() * apiKeys.length)] : "";
  let { messages, key = apiKey, pdfID } = body;

  // for debug
  // messages = messages.slice(0, 4);

  const dataPath = "data/" + pdfID + ".csv";
  // 这里的持久化方法待改进
  if (PDFDataWithEmbedding.pdfID && Object.keys(PDFDataWithEmbedding.pdfID).length === messages.length) {
    // 内存中已经存在数据
    console.debug("data exists:" + pdfID)
    return {
      body: JSON.stringify({
        success: true,
        message: "ok",
        // data: PDFDataWithEmbedding.pdfID,
      }),
    }
  } else {
    // 存在持久化数据
    if (fs.existsSync(dataPath)) {
      console.debug("file exists:" + dataPath);
      PDFDataWithEmbedding.pdfID = readContextsFromCsv(dataPath);
      return {
        body: JSON.stringify({
          success: true,
          message: "ok",
          // data: PDFDataWithEmbedding.pdfID,
        }),
      }
    }
  }

  if (!key.startsWith("sk-")) key = apiKey;
  if (!key) {
    return new Response("没有填写 OpenAI API key");
  }

  const configuration = new Configuration({
    apiKey: key,
  });
  const openai = new OpenAIApi(configuration);

  const res = await computeDocEmbeddings(messages, openai);
  PDFDataWithEmbedding.pdfID = res
  writeContextsToCsv(res, dataPath);

  return {
    body: JSON.stringify({
      success: true,
      message: "ok",
      data: "Now you can chat with pdf",
    }),
  };
};

export async function getEmbedding(messages: string, openai: OpenAIApi) {
  let done = false;
  let result;
  while (!done) {
    try {
      const response = await openai.createEmbedding({
        model: "text-embedding-ada-002",
        input: messages,
      });
      result = {
        arr: response["data"]["data"][0]["embedding"],
        prompt_tokens: response?.data?.usage?.prompt_tokens,
      };
      done = true;
    } catch (error) {
      console.log("Error getting embedding, retrying in 5 seconds");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  return result;
}

export async function computeDocEmbeddings(df: DataFrame[], openai: OpenAIApi) {
  const result: Contexts = {};
  // 创建一个新的进度条实例
  const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
  // 开始进度条
  progressBar.start(df.length, 0);
  for (const [idx, r] of df.entries()) {
    const e = await getEmbedding(r.str, openai);
    result[idx] = {
      arr: e.arr,
      content: r.str,
      pageNum: r.pageNum,
      content_tokens: e.prompt_tokens,
      content_length: r.str.length,
    };
    // 更新进度条
    progressBar.update(idx + 1);
  }
  // 停止进度条
  progressBar.stop();
  return result;
}

function writeContextsToCsv(contexts: Contexts, filePath: string) {
  // 创建二维数组
  const data: any[][] = [];
  // 添加表头
  data.push(["idx", "content", "pageNum", "content_tokens", "content_length", "arr"]);
  // 遍历 Contexts 对象
  for (const [idx, { arr, content, pageNum, content_tokens, content_length }] of Object.entries(contexts)) {
    // 添加数据行
    data.push([idx, JSON.stringify(content), pageNum, content_tokens, content_length, JSON.stringify(arr)]);
  }
  // 将二维数组转换为 CSV 格式的字符串
  const csvString = Papa.unparse(data);
  // 写入文件
  fs.writeFileSync(filePath, csvString);
}

function readContextsFromCsv(filePath: string): Contexts {
  // 读取文件内容
  const csvString = fs.readFileSync(filePath, "utf-8");
  // 使用 Papa Parse 库解析 CSV 文件
  const data = Papa.parse(csvString).data;
  // 创建 Contexts 对象
  const contexts: Contexts = {};
  console.debug(data);
  // 遍历数据行（跳过表头）
  for (const [idx, content, pageNum, content_tokens, content_length, arr] of data.slice(1)) {
    // 添加到 Contexts 对象中
    contexts[idx] = {
      content: content,
      pageNum: Number(pageNum),
      content_tokens: Number(content_tokens),
      content_length: Number(content_length),
      arr: JSON.parse(arr),
    };
  }
  return contexts;
}

async function orderDocumentSectionsByQuerySimilarity(query: string, contexts: Contexts, openai: OpenAIApi): Promise<DocumentSimilarities> {
  const queryEmbedding = await getEmbedding(query, openai);

  const documentSimilarities = Object.entries(contexts)
    .map(([key, { arr: docEmbedding }]) => [cosineSimilarity(queryEmbedding.arr, docEmbedding), key] as [number, string])
    .sort(([similarityA], [similarityB]) => similarityB - similarityA);

  return documentSimilarities;
}

export async function constructPrompt(question: string, contextEmbeddings: Contexts, openai: OpenAIApi) {
  const mostRelevantDocumentSections = await orderDocumentSectionsByQuerySimilarity(question, contextEmbeddings, openai);

  let chosenSections: string[] = [];
  let chosenSectionsLen = 0;
  let chosenSectionsIndexes: string[] = [];

  // let mostRelevantDocumentSections:DocumentSimilarities =[
  //   [
  //     0.9031055643929312,
  //     `["Athletics at the 2020 Summer Olympics – Men's high jump","Summary"]`
  //   ]
  // ];

  for (const [_, key] of mostRelevantDocumentSections) {
    const documentSection = contextEmbeddings[key]
    chosenSectionsLen += +documentSection.content_tokens + separatorLen;
    if (chosenSectionsLen > MAX_SECTION_TOKEN_LEN) {
      break;
    }

    chosenSections.push(SEPARATOR + documentSection.content.replace('\n', ' '));
    chosenSectionsIndexes.push(key);
  }

  console.log(`Selected ${chosenSections.length} document sections:`);

  const header = `Answer the question as truthfully as possible using the provided context, and if the answer is not contained within the text below, say "I don't know", and always speak chinese.\n\nContext:\n`;

  return header + chosenSections.join('') + '\n\n Q: ' + question + '\n A:';
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync=promisify(execFile);
const OCR_SCRIPT=path.resolve('backend/policy-contract-ocr.swift');

export async function recognizePolicyContractPages(filePath,pageNumbers=[]) {
  if (!pageNumbers.length) return [];
  if (process.platform!=='darwin') throw new Error('当前环境不支持本机合同 OCR');
  const unique=[...new Set(pageNumbers.map(Number).filter((page)=>Number.isInteger(page) && page>0))].sort((a,b)=>a-b);
  const {stdout}=await execFileAsync('/usr/bin/swift',[OCR_SCRIPT,filePath,unique.join(',')],{
    timeout:240_000,maxBuffer:8*1024*1024,
  });
  const result=JSON.parse(stdout);
  if (!Array.isArray(result)) throw new Error('本机 OCR 未返回页面结果');
  return result.filter((item)=>Number.isInteger(item?.num) && typeof item?.text==='string');
}

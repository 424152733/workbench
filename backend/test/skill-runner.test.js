import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { createSkillRunnerServer, runRunwareImageGenerator } from '../skill-runner.js';

const projectDir = path.resolve('.');
const samplePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2sAAAAASUVORK5CYII=','base64');
let server;
let baseUrl;
let imageJobs;
let deepseekRequests;
let previousRunwareKey;
let previousRunwareImageModel;
let previousDeepSeekKey;

const sampleCardPlan = (count = 4) => Array.from({length:count},(_unused,index) => ({
  role:['cover','concept','checklist','boundary','summary'][index],
  headline:['等待期是什么','先弄懂概念','看合同核对','注意适用边界','记住这几点'][index],
  keyPoints:[`保险等待期相关要点 ${index + 1}`],
  visualDirection:'用清楚易懂的日常插画表达，不新增文字。',
}));

before(async () => {
  previousRunwareKey = process.env.RUNWARE_API_KEY;
  previousRunwareImageModel = process.env.RUNWARE_IMAGE_MODEL;
  previousDeepSeekKey = process.env.DEEPSEEK_API_KEY;
  process.env.RUNWARE_API_KEY = 'test-api-key';
  delete process.env.RUNWARE_IMAGE_MODEL;
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  imageJobs = [];
  deepseekRequests = [];
  const deepseekResponses = async (request) => {
    deepseekRequests.push(request);
    const input = JSON.parse(request.input.replace(/\n\nPlease return valid json\.$/i,''));
    if (Array.isArray(input.drafts)) {
      const drafts = input.drafts.map((draft) => ({platform:draft.platform,text:`${draft.text}（DeepSeek humanizer）`,...(draft.cardPlan ? {cardPlan:draft.cardPlan} : {})}));
      return drafts.length === 1 && ['测试单条文本格式','单平台数组格式','单平台小红书图卡格式'].includes(input.drafts[0].title)
        ? {text:drafts[0].text,...(drafts[0].cardPlan ? {cardPlan:drafts[0].cardPlan} : {})} : {drafts};
    }
    const plannedImages = [
      {slug:'waiting-period-cover',kind:'cover',aspectRatio:'3:4',prompt:'一张简体中文保险科普封面插画。只显示标题“等待期过后就都能赔吗？”，画面用日历和保险合同做清楚易懂的比喻。sketch-notes 手绘知识卡风格，macaron 配色。'},
      {slug:'policy-checks',kind:'content',aspectRatio:'3:4',prompt:'一张简体中文知识卡插画，说明等待期结束后仍需看保险责任、责任免除和适用条件。用三格清晰图示，不增加其他文字。'},
      {slug:'waiting-period-timeline',kind:'timeline',aspectRatio:'3:4',prompt:'用时间轴说明等待期的起点和合同约定，等待期条款以合同为准。'},
      {slug:'coverage-details',kind:'details',aspectRatio:'3:4',prompt:'用放大镜和合同图示说明等待期后仍需核对保险责任和适用条件。'},
      {slug:'reader-checklist',kind:'checklist',aspectRatio:'3:4',prompt:'列出核对保险责任、责任免除和时间范围的简明检查清单。'},
    ];
    return {
      analysis:'保险等待期与保障责任的关系，需要对照合同中的具体条件说明。',
      outline:'封面：等待期的误区。内容：等待期结束不等于所有情况都赔；核对保险责任、责任免除和适用条件。',
      images:Number.isInteger(input.requestedImageCount) ? plannedImages.slice(0,input.requestedImageCount) : input.imageMode === 'production' ? plannedImages.slice(0,4) : plannedImages.slice(0,2),
    };
  };
  const imageGenerator = async (job) => {
    const promptContents = await Promise.all(job.images.map((image) => readFile(image.promptPath,'utf8')));
    imageJobs.push({...job,promptContents});
    assert.ok(job.images.every((image) => image.promptPath && image.outputPath));
    assert.equal(job.model,'openai:gpt-image@2.5-flare');
    for (const [index,image] of job.images.entries()) {
      const promptFile = promptContents[index];
      assert.match(promptFile,/等待期/);
      await mkdir(path.dirname(image.outputPath),{recursive:true});
      await writeFile(image.outputPath,samplePng);
    }
  };
  server = createSkillRunnerServer({projectDir,token:'runner-test-token',deepseekResponses,imageGenerator});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  if (previousRunwareKey === undefined) delete process.env.RUNWARE_API_KEY;
  else process.env.RUNWARE_API_KEY = previousRunwareKey;
  if (previousRunwareImageModel === undefined) delete process.env.RUNWARE_IMAGE_MODEL;
  else process.env.RUNWARE_IMAGE_MODEL = previousRunwareImageModel;
  if (previousDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = previousDeepSeekKey;
});

test('skill runner health reports installed skills and separates DeepSeek text from Runware image generation',async () => {
  const response = await fetch(`${baseUrl}/health`);
  const payload = await response.json();
  assert.equal(response.status,200);
  assert.ok(payload.skills.includes('humanizer-zh'));
  assert.ok(payload.skills.includes('baoyu-xhs-images'));
  assert.ok(payload.skills.includes('baoyu-article-illustrator'));
  assert.ok(payload.skills.includes('baoyu-image-gen'));
  assert.equal(payload.runwareConfigured,true);
  assert.equal(payload.deepseekConfigured,true);
  assert.equal(payload.deepseekModel,'deepseek-flash');
  assert.equal(payload.imageModel,'openai:gpt-image@2.5-flare');
});

test('skill runner requires the configured token and only exposes supported skills',async () => {
  const unauthorized = await fetch(`${baseUrl}/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({skill:'humanizer-zh'})});
  assert.equal(unauthorized.status,401);
  const unsupported = await fetch(`${baseUrl}/run`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer runner-test-token'},body:JSON.stringify({skill:'arbitrary-shell'})});
  assert.equal(unsupported.status,400);
});

test('skill execution requires a DeepSeek API key and reports the missing configuration',async () => {
  const configuredKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const response = await fetch(`${baseUrl}/run`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer runner-test-token'},
      body:JSON.stringify({skill:'humanizer-zh',platform:'知乎',title:'测试标题',text:'测试正文'}),
    });
    const payload = await response.json();
    assert.equal(response.status,503);
    assert.match(payload.message,/DEEPSEEK_API_KEY/);
  } finally {
    process.env.DEEPSEEK_API_KEY = configuredKey;
  }
});

test('humanizer-zh instructions are sent to DeepSeek and return edited platform drafts',async () => {
  const response = await fetch(`${baseUrl}/run`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer runner-test-token'},
    body:JSON.stringify({skill:'humanizer-zh',drafts:[
      {platform:'知乎',title:'等待期是什么',text:'用简单的话解释等待期。'},
      {platform:'公众号',title:'保险责任怎么看',text:'先看合同中的约定。'},
    ]}),
  });
  const payload = await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.provider,'humanizer-zh');
  assert.deepEqual(payload.drafts.map((draft) => draft.platform),['知乎','公众号']);
  assert.ok(payload.drafts.every((draft) => draft.text.includes('DeepSeek humanizer')));
  assert.match(deepseekRequests.at(-1).instructions,/保留信息和确定程度/);
  assert.match(deepseekRequests.at(-1).instructions,/humanizer-zh/);
  assert.match(deepseekRequests.at(-1).instructions,/不要输出 \*\* 符号/);
  assert.match(deepseekRequests.at(-1).instructions,/避免“第一步”“第二步”“第几步”/);
  assert.match(deepseekRequests.at(-1).input,/\bjson\b/i);
});

test('humanizer-zh uses DeepSeek for any content category',async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  const previousDeepSeekRequestCount = deepseekRequests.length;
  try {
    const response = await fetch(`${baseUrl}/run`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer runner-test-token'},
      body:JSON.stringify({skill:'humanizer-zh',provider:'deepseek',drafts:[{platform:'知乎',title:'产品解读',text:'只依据确认过的产品资料。'}]}),
    });
    const payload = await response.json();
    assert.equal(response.status,200);
    assert.match(payload.drafts[0].text,/DeepSeek humanizer/);
    assert.equal(deepseekRequests.length,previousDeepSeekRequestCount + 1);
    assert.match(deepseekRequests[0].instructions,/保留信息和确定程度/);
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});

test('Runware is rejected as a text provider and image planning checks both model keys before planning',async () => {
  const unsupported = await fetch(`${baseUrl}/run`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer runner-test-token'},
    body:JSON.stringify({skill:'humanizer-zh',provider:'runware',platform:'知乎',title:'测试标题',text:'测试正文'}),
  });
  assert.equal(unsupported.status,400);
  const configuredKey = process.env.RUNWARE_API_KEY;
  const deepseekRequestCount = deepseekRequests.length;
  delete process.env.RUNWARE_API_KEY;
  try {
    const response = await fetch(`${baseUrl}/run`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer runner-test-token'},
      body:JSON.stringify({skill:'baoyu-xhs-images',platform:'小红书',title:'等待期是什么',cardPlan:sampleCardPlan(4),imageMode:'production'}),
    });
    const payload = await response.json();
    assert.equal(response.status,503);
    assert.match(payload.message,/RUNWARE_API_KEY/);
    assert.equal(deepseekRequests.length,deepseekRequestCount,'image planning must not spend DeepSeek tokens when image generation is unavailable');
  } finally {
    process.env.RUNWARE_API_KEY = configuredKey;
  }
});

test('image planning uses DeepSeek while actual image generation stays on Runware GPT Image',async () => {
  const deepseekRequestCount = deepseekRequests.length;
  const response = await fetch(`${baseUrl}/run`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer runner-test-token'},
    body:JSON.stringify({skill:'baoyu-xhs-images',platform:'小红书',title:'等待期是什么',cardPlan:sampleCardPlan(4),imageMode:'test'}),
  });
  const payload = await response.json();
  assert.equal(response.status,200);
  assert.equal(deepseekRequests.length,deepseekRequestCount + 1);
  assert.equal(payload.artifacts.length,1);
  assert.ok(imageJobs.at(-1).images.every((image) => image.provider === 'runware' && image.model === 'openai:gpt-image@2.5-flare'));
});

test('humanizer-zh preserves and returns the Xiaohongshu card plan',async () => {
  const plan = sampleCardPlan(3);
  const response = await fetch(`${baseUrl}/run`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer runner-test-token'},
    body:JSON.stringify({skill:'humanizer-zh',platform:'小红书',title:'等待期是什么',text:'精炼的发布配文。',cardPlan:plan}),
  });
  const payload = await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(payload.cardPlan,plan);
  assert.match(deepseekRequests.at(-1).instructions,/保留卡片数量、顺序、role 和每张卡片的要点数量/);
  assert.deepEqual(lastResponseInput().drafts[0].cardPlan,plan);
});

test('single humanizer-zh accepts both JSON response shapes',async () => {
  for (const title of ['测试单条文本格式','测试单条草稿格式']) {
    const response = await fetch(`${baseUrl}/run`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer runner-test-token'},
      body:JSON.stringify({skill:'humanizer-zh',platform:'知乎',title,text:'用简单的话解释等待期。'}),
    });
    const payload = await response.json();
    assert.equal(response.status,200);
    assert.match(payload.text,/DeepSeek humanizer/);
  }
});

test('humanizer-zh accepts a single-draft response when generation sends a one-platform drafts array',async () => {
  const response = await fetch(`${baseUrl}/run`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer runner-test-token'},
    body:JSON.stringify({skill:'humanizer-zh',drafts:[{platform:'知乎',title:'单平台数组格式',text:'用简单的话解释等待期。'}]}),
  });
  const payload = await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(payload.drafts,[{platform:'知乎',text:'用简单的话解释等待期。（DeepSeek humanizer）'}]);
  assert.match(deepseekRequests.at(-1).instructions,/即使输入位于 drafts 数组中，也按单条格式返回/);
});

test('single-platform Xiaohongshu generation preserves card plans returned in the single-draft response shape',async () => {
  const cardPlan = sampleCardPlan(3);
  const response = await fetch(`${baseUrl}/run`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer runner-test-token'},
    body:JSON.stringify({skill:'humanizer-zh',drafts:[{platform:'小红书',title:'单平台小红书图卡格式',text:'精炼的发布配文。',cardPlan}]}),
  });
  const payload = await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(payload.drafts[0].cardPlan,cardPlan);
  assert.equal(payload.drafts[0].platform,'小红书');
});

test('Baoyu production mode plans three to five Xiaohongshu cards before sending prompts to Runware',async () => {
  const previousJobs = imageJobs.length;
  const response = await fetch(`${baseUrl}/run`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer runner-test-token'},
    body:JSON.stringify({skill:'baoyu-xhs-images',platform:'小红书',title:'等待期是什么',cardPlan:sampleCardPlan(4),imageMode:'production',imageOptions:{style:'bold',layout:'comparison',palette:'neon'}}),
  });
  const payload = await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.skill,'baoyu-xhs-images');
  assert.equal(payload.artifacts.length,4);
  assert.ok(payload.artifacts.every((artifact) => artifact.mimeType === 'image/png' && artifact.base64 === samplePng.toString('base64')));
  assert.equal(imageJobs.length,previousJobs + 1);
  const generatedJob = imageJobs.at(-1);
  assert.equal(generatedJob.jobs,2);
  assert.ok(generatedJob.images.every((job) => job.ar === '3:4' && job.provider === 'runware'));
  for (const promptFile of generatedJob.promptContents) {
    assert.match(promptFile,/aspect_ratio: 3:4/);
    assert.match(promptFile,/等待期/);
  }
  const instructions = deepseekRequests.at(-1).instructions;
  assert.match(deepseekRequests.at(-1).input,/\bjson\b/i);
  assert.deepEqual(lastResponseInput().style,'bold');
  assert.equal(lastResponseInput().layout,'comparison');
  assert.equal(lastResponseInput().palette,'neon');
  assert.deepEqual(lastResponseInput().requestedImageCountRange,{min:3,max:5});
  assert.equal(lastResponseInput().imageMode,'production');
  assert.equal(lastResponseInput().cardPlan.length,4);
  assert.equal('text' in lastResponseInput(),false);
  assert.match(instructions,/只把它当作图卡内容/);
  assert.match(instructions,/Image Card Series Generator/);
  assert.match(instructions,/当前是生产模式，按输入的 3–5 张卡片规划逐张生成/);
  assert.match(instructions,/references\/workflows\/analysis-framework\.md/);
  assert.match(instructions,/baoyu-image-gen/);
  assert.match(instructions,/references\/presets\/bold\.md/);
  assert.match(instructions,/references\/palettes\/neon\.md/);
  assert.doesNotMatch(instructions,/references\/presets\/sketch-notes\.md/);
  assert.match(instructions,/auto 项请结合文章内容/);
});

test('Baoyu test mode plans one Xiaohongshu card to keep development runs small',async () => {
  const previousJobs = imageJobs.length;
  const response = await fetch(`${baseUrl}/run`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer runner-test-token'},
    body:JSON.stringify({skill:'baoyu-xhs-images',platform:'小红书',title:'等待期是什么',cardPlan:sampleCardPlan(4),imageMode:'test'}),
  });
  const payload = await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.artifacts.length,1);
  assert.equal(imageJobs.length,previousJobs + 1);
  assert.equal(imageJobs.at(-1).images.length,1);
  assert.equal(imageJobs.at(-1).jobs,1);
  assert.equal(lastResponseInput().requestedImageCount,1);
  assert.equal(lastResponseInput().cardPlan.length,1);
  assert.equal(lastResponseInput().cardPlan[0].role,'cover');
  assert.equal('text' in lastResponseInput(),false);
  assert.equal(lastResponseInput().imageMode,'test');
  assert.match(deepseekRequests.at(-1).instructions,/当前是测试模式，输入中只有封面卡片，必须严格输出 1 张小红书封面图/);
});

test('Baoyu plans outside the selected Xiaohongshu mode are rejected before any paid image generation',async () => {
  let imageGenerationCalled = false;
  const validationServer = createSkillRunnerServer({
    projectDir,
    token:'xhs-count-mismatch-test-token',
    deepseekResponses:async () => ({images:[
      {slug:'cover',kind:'cover',aspectRatio:'3:4',prompt:'封面图'},
      {slug:'content',kind:'content',aspectRatio:'3:4',prompt:'内容图'},
    ]}),
    imageGenerator:async () => { imageGenerationCalled = true; },
  });
  validationServer.listen(0,'127.0.0.1');
  await once(validationServer,'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${validationServer.address().port}/run`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer xhs-count-mismatch-test-token'},
      body:JSON.stringify({skill:'baoyu-xhs-images',platform:'小红书',title:'等待期',cardPlan:sampleCardPlan(3),imageMode:'test'}),
    });
    assert.equal(response.status,502);
    const payload = await response.json();
    assert.match(payload.message,/测试模式固定生成 1 张卡片/);
    assert.match(payload.message,/本次未提交生图任务/);
    assert.equal(imageGenerationCalled,false);
  } finally {
    await new Promise((resolve) => validationServer.close(resolve));
  }
});

test('Xiaohongshu image mode must be test or production',async () => {
  const response = await fetch(`${baseUrl}/run`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer runner-test-token'},
    body:JSON.stringify({skill:'baoyu-xhs-images',platform:'小红书',title:'等待期是什么',text:'测试正文',imageMode:'preview'}),
  });
  assert.equal(response.status,400);
  assert.match((await response.json()).message,/生图模式只能是测试或生产/);
});

test('production mode refuses fewer than three planned cards before any paid image generation',async () => {
  let imageGenerationCalled = false;
  const validationServer = createSkillRunnerServer({
    projectDir,
    token:'xhs-production-count-test-token',
    deepseekResponses:async () => ({images:[
      {slug:'cover',kind:'cover',aspectRatio:'3:4',prompt:'封面图'},
      {slug:'content',kind:'content',aspectRatio:'3:4',prompt:'内容图'},
    ]}),
    imageGenerator:async () => { imageGenerationCalled = true; },
  });
  validationServer.listen(0,'127.0.0.1');
  await once(validationServer,'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${validationServer.address().port}/run`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer xhs-production-count-test-token'},
      body:JSON.stringify({skill:'baoyu-xhs-images',platform:'小红书',title:'等待期',cardPlan:sampleCardPlan(3),imageMode:'production'}),
    });
    assert.equal(response.status,502);
    assert.match((await response.json()).message,/生产模式需要规划 3 至 5 张卡片/);
    assert.equal(imageGenerationCalled,false);
  } finally {
    await new Promise((resolve) => validationServer.close(resolve));
  }
});

function lastResponseInput() {
  return JSON.parse(deepseekRequests.at(-1).input.replace(/\n\nPlease return valid json\.$/i,''));
}

test('baoyu article illustrator is selected for non-Xiaohongshu platforms',async () => {
  const response = await fetch(`${baseUrl}/run`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer runner-test-token'},
    body:JSON.stringify({skill:'baoyu-article-illustrator',platform:'公众号',title:'怎么读保险责任',text:'先核对合同里的保险责任。',imageOptions:{type:'timeline',style:'watercolor',palette:'warm'}}),
  });
  const payload = await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.skill,'baoyu-article-illustrator');
  assert.equal(payload.artifacts.length,2);
  assert.match(deepseekRequests.at(-1).instructions,/Analyze articles, identify illustration positions/);
  assert.match(deepseekRequests.at(-1).instructions,/references\/prompt-construction\.md/);
  assert.match(deepseekRequests.at(-1).instructions,/references\/styles\/watercolor\.md/);
  assert.match(deepseekRequests.at(-1).instructions,/references\/palettes\/warm\.md/);
  assert.doesNotMatch(deepseekRequests.at(-1).instructions,/references\/styles\/notion\.md/);
  assert.deepEqual(lastResponseInput().type,'timeline');
  assert.equal(lastResponseInput().style,'watercolor');
  assert.equal(lastResponseInput().palette,'warm');
});

test('image runner rejects unsupported visual preferences',async () => {
  const response = await fetch(`${baseUrl}/run`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer runner-test-token'},
    body:JSON.stringify({skill:'baoyu-xhs-images',platform:'小红书',title:'等待期是什么',cardPlan:sampleCardPlan(3),imageOptions:{style:'unknown'}}),
  });
  assert.equal(response.status,400);
  assert.match((await response.json()).message,/不支持的图文style设置/);
});

test('GPT-Image-2.5 Flare prompts over the model limit are rejected before image generation',async () => {
  let imageGenerationCalled = false;
  const validationServer = createSkillRunnerServer({
    projectDir,
    token:'gpt-image-prompt-limit-test-token',
    deepseekResponses:async () => ({images:[{slug:'long-prompt',kind:'cover',aspectRatio:'3:4',prompt:'图'.repeat(32_001)}]}),
    imageGenerator:async () => { imageGenerationCalled = true; },
  });
  validationServer.listen(0,'127.0.0.1');
  await once(validationServer,'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${validationServer.address().port}/run`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer gpt-image-prompt-limit-test-token'},
      body:JSON.stringify({skill:'baoyu-xhs-images',platform:'小红书',title:'等待期',cardPlan:sampleCardPlan(3)}),
    });
    assert.equal(response.status,413);
    assert.match((await response.json()).message,/prompt长度超出限制/);
    assert.equal(imageGenerationCalled,false);
  } finally {
    await new Promise((resolve) => validationServer.close(resolve));
  }
});

test('Runware image generator posts GPT-Image-2.5 Flare tasks and saves returned base64 images',async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.RUNWARE_API_KEY;
  const previousModel = process.env.RUNWARE_IMAGE_MODEL;
  const workDir = await mkdtemp(path.join(os.tmpdir(),'runware-image-test-'));
  const outputPath = path.join(workDir,'image.png');
  process.env.RUNWARE_API_KEY = 'runware-test-key';
  delete process.env.RUNWARE_IMAGE_MODEL;
  globalThis.fetch = async (input,options) => {
    assert.equal(String(input),'https://api.runware.ai/v1');
    assert.equal(options.headers.Authorization,'Bearer runware-test-key');
    const [task] = JSON.parse(options.body);
    assert.equal(task.taskType,'imageInference');
    assert.equal(task.model,'openai:gpt-image@2.5-flare');
    assert.equal(task.positivePrompt,'一张保险科普插画');
    assert.equal(task.width,960);
    assert.equal(task.height,1280);
    assert.equal(task.outputType,'base64Data');
    assert.equal(task.outputFormat,'PNG');
    assert.equal(task.settings,undefined);
    return new Response(JSON.stringify([{taskType:'imageInference',taskUUID:task.taskUUID,errors:[],imageBase64Data:samplePng.toString('base64')}]),{
      status:200,headers:{'Content-Type':'application/json'},
    });
  };
  try {
    await runRunwareImageGenerator({images:[{prompt:'一张保险科普插画',aspectRatio:'3:4',outputPath}],jobs:1,timeoutMs:5_000});
    assert.deepEqual(await readFile(outputPath),samplePng);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.RUNWARE_API_KEY;
    else process.env.RUNWARE_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.RUNWARE_IMAGE_MODEL;
    else process.env.RUNWARE_IMAGE_MODEL = previousModel;
    await rm(workDir,{recursive:true,force:true});
  }
});

test('Runware image generator accepts data URI and image URL response formats',async () => {
  const previousFetch = globalThis.fetch;
  const workDir = await mkdtemp(path.join(os.tmpdir(),'runware-image-format-test-'));
  process.env.RUNWARE_API_KEY = 'runware-test-key';
  try {
    const dataUriPath = path.join(workDir,'data-uri.png');
    globalThis.fetch = async (_input,options) => {
      const [task] = JSON.parse(options.body);
      return new Response(JSON.stringify({data:[{taskUUID:task.taskUUID,imageDataURI:`data:image/png;base64,${samplePng.toString('base64')}`}]}),{
        status:200,headers:{'Content-Type':'application/json'},
      });
    };
    await runRunwareImageGenerator({images:[{prompt:'data uri image',aspectRatio:'3:4',outputPath:dataUriPath}],jobs:1,timeoutMs:5_000});
    assert.deepEqual(await readFile(dataUriPath),samplePng);

    const urlPath = path.join(workDir,'url.png');
    let imageDownloadRequested = false;
    globalThis.fetch = async (input,options) => {
      if (String(input) === 'https://cdn.runware.test/image.png') {
        imageDownloadRequested = true;
        return new Response(samplePng,{status:200,headers:{'Content-Type':'image/png'}});
      }
      const [task] = JSON.parse(options.body);
      return new Response(JSON.stringify([{taskUUID:task.taskUUID,imageURL:'https://cdn.runware.test/image.png'}]),{
        status:200,headers:{'Content-Type':'application/json'},
      });
    };
    await runRunwareImageGenerator({images:[{prompt:'url image',aspectRatio:'3:4',outputPath:urlPath}],jobs:1,timeoutMs:5_000});
    assert.equal(imageDownloadRequested,true);
    assert.deepEqual(await readFile(urlPath),samplePng);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(workDir,{recursive:true,force:true});
  }
});

test('Runware image generator returns a clear error for non-image data',async () => {
  const previousFetch = globalThis.fetch;
  const workDir = await mkdtemp(path.join(os.tmpdir(),'runware-invalid-image-test-'));
  process.env.RUNWARE_API_KEY = 'runware-test-key';
  globalThis.fetch = async (_input,options) => {
    const [task] = JSON.parse(options.body);
    return new Response(JSON.stringify([{taskUUID:task.taskUUID,imageBase64Data:Buffer.from('not an image').toString('base64')}]),{
      status:200,headers:{'Content-Type':'application/json'},
    });
  };
  try {
    await assert.rejects(
      runRunwareImageGenerator({images:[{prompt:'invalid image',aspectRatio:'3:4',outputPath:path.join(workDir,'image.png')}],jobs:1,timeoutMs:5_000}),
      (error) => error.statusCode === 502 && /不是有效的 PNG、JPEG 或 WebP 图片/.test(error.message),
    );
  } finally {
    globalThis.fetch = previousFetch;
    await rm(workDir,{recursive:true,force:true});
  }
});

import { useEffect } from 'react';
import { Modal } from 'antd';
import { channelNames, platformsForTopic } from '../../platforms.js';
import { defaultImageStyles, defaultXhsImageMode } from './content-options.js';
import { createStoredZipBlob } from './zip-assets.js';

export function useContentWorkspaceActions({
  api, performApiAction, messageApi, workspace, settings, setSettings,
  go, dateValue, handleApiError, showSuccess, reloadDashboard,
}) {
  const {
    topics, setTopics, selectedTopic, setSelectedTopic, topicModalOpen,
    setTopicModalOpen, topicForm, platform, setPlatform, drafts, setDrafts,
    platformStatus, setPlatformStatus, checks, setChecks, humanized, setHumanized,
    draftDirty, setDraftDirty, generationBusy, setGenerationBusy, scheduleOpen,
    setScheduleOpen, scheduleForm, voiceOpen, setVoiceOpen, voiceForm,
    imageStylesOpen, setImageStylesOpen, imageStylesForm, suggestionsOpen,
    setSuggestionsOpen, suggestions, setSuggestions, suggestionInsuranceType,
    suggestionsGenerated, setSuggestionsGenerated, publishOpen, setPublishOpen,
    publishForm, assetBusy, setAssetBusy, imagePreviewOpen, imagePreviewIndex,
    setImagePreviewIndex, setImagePreviewOpen,
  } = workspace;

  const syncDraftToTopic = (topicId, channel, draft) => {
    setDrafts((old) => ({ ...old, [channel]: draft }));
    setPlatformStatus((old) => ({ ...old, [channel]: draft.status }));
    setChecks((old) => ({ ...old, [channel]: draft.checks || [false,false,false] }));
    setHumanized((old) => ({ ...old, [channel]: Boolean(draft.humanized) }));
    setSelectedTopic((old) => old?.id === topicId ? { ...old, drafts: { ...(old.drafts || {}), [channel]: draft } } : old);
    setTopics((old) => old.map((item) => item.id === topicId ? { ...item, drafts: { ...(item.drafts || {}), [channel]: draft } } : item));
  };

  const saveCurrentDraft = async () => {
    if (!draftDirty || !selectedTopic || !drafts[platform]) return null;
    const saved = await performApiAction('draft:save',() => api.saveDraft(selectedTopic.id,platform,{ ...drafts[platform],checks:checks[platform] || drafts[platform].checks }));
    syncDraftToTopic(selectedTopic.id,platform,saved);
    setDraftDirty(false);
    return saved;
  };

  const chooseTopic = async (topic) => {
    if (!topic) return;
    if (selectedTopic?.id !== topic.id) {
      try { await saveCurrentDraft(); }
      catch (error) { handleApiError(error); return; }
    }
    const topicPlatforms = platformsForTopic(topic);
    if (!topicPlatforms.includes(platform)) setPlatform(topicPlatforms[0]);
    const nextDrafts = topic.drafts || {};
    setSelectedTopic(topic);
    setDrafts(nextDrafts);
    setPlatformStatus(Object.fromEntries(channelNames.map((channel) => [channel,nextDrafts[channel]?.status || '草稿'])));
    setChecks(Object.fromEntries(channelNames.map((channel) => [channel,nextDrafts[channel]?.checks || [false,false,false]])));
    setHumanized(Object.fromEntries(channelNames.map((channel) => [channel,Boolean(nextDrafts[channel]?.humanized)])));
    setDraftDirty(false);
  };

  const createTopic = async (values) => {
    try {
      const topic = await api.createTopic({ ...values,dueDate:dateValue(values.dueDate) });
      setTopics((old) => [topic,...old]);
      chooseTopic(topic);
      setTopicModalOpen(false);
      topicForm.resetFields();
      go('content');
      showSuccess('选题已加入内容池');
    } catch (error) { handleApiError(error); }
  };

  const confirmDeleteTopic = (topic) => Modal.confirm({
    title:'删除这个选题？',
    content:'删除后，该选题的三平台稿件、审核记录和已上传图片也会一起删除，无法恢复。',
    okText:'删除选题',
    cancelText:'保留',
    okButtonProps:{color:'danger',variant:'outlined'},
    cancelButtonProps:{color:'danger',variant:'outlined'},
    onOk:() => performApiAction(`topic:delete:${topic.id}`,async () => {
      try {
        await api.deleteTopic(topic.id);
        const remaining = topics.filter((item) => item.id !== topic.id);
        setTopics(remaining);
        if (selectedTopic?.id === topic.id) {
          const next = remaining[0] || null;
          setSelectedTopic(next);
          setDrafts(next?.drafts || {});
          setPlatformStatus(Object.fromEntries(channelNames.map((channel) => [channel,next?.drafts?.[channel]?.status || '草稿'])));
          setChecks(Object.fromEntries(channelNames.map((channel) => [channel,next?.drafts?.[channel]?.checks || [false,false,false]])));
          setHumanized(Object.fromEntries(channelNames.map((channel) => [channel,Boolean(next?.drafts?.[channel]?.humanized)])));
          setPlatform(next ? platformsForTopic(next)[0] : channelNames[0]);
          setDraftDirty(false);
        }
        showSuccess('选题及其稿件、素材已删除');
      } catch (error) {
        handleApiError(error);
        return false;
      }
      return undefined;
    }),
  });

  const generateDrafts = async () => {
    if (!selectedTopic) { messageApi.warning('请先选择或新建一个选题'); return; }
    setGenerationBusy(true);
    try {
      await saveCurrentDraft();
      const result = await api.generateDrafts(selectedTopic.id);
      setTopics((old) => old.map((item) => item.id === result.topic.id ? result.topic : item));
      chooseTopic(result.topic);
      setDraftDirty(false);
      messageApi.info(result.mode === 'gpt' ? `GPT 已生成文案，humanizer-zh 已润色（${result.provider}）` : '演示文案已生成并经 humanizer-zh 润色；配置 RUNWARE_API_KEY 后可使用 GPT 文案生成。');
    } catch (error) { handleApiError(error); }
    finally { setGenerationBusy(false); }
  };

  const humanizeDraft = async () => {
    if (!selectedTopic || !drafts[platform]) { messageApi.warning('请先生成这个平台的草稿'); return; }
    try {
      const draft = await api.humanizeDraft(selectedTopic.id,platform);
      syncDraftToTopic(selectedTopic.id,platform,draft);
      setDraftDirty(false);
      messageApi.success(draft.provider === 'humanizer-zh' ? 'humanizer-zh 已润色，请核对前后事实和限定条件' : '已按大白话原则润色，请核对前后事实和限定条件');
    } catch (error) { handleApiError(error); }
  };

  const generateCardPlan = async () => {
    if (!selectedTopic || platform !== '小红书' || !drafts[platform]) { messageApi.warning('请先生成小红书草稿'); return; }
    try {
      const draft = await performApiAction('draft:card-plan',() => api.generateCardPlan(selectedTopic.id,platform));
      syncDraftToTopic(selectedTopic.id,platform,draft);
      setDraftDirty(false);
      messageApi.success('图卡规划已生成。此操作只生成文本，没有调用生图模型。');
    } catch (error) { handleApiError(error); }
  };

  const updateDraft = (field,value) => {
    if (!drafts[platform]) return;
    setDrafts((old) => ({ ...old,[platform]:{ ...old[platform],[field]:value,status:'草稿',checks:[false,false,false] } }));
    setPlatformStatus((old) => ({ ...old,[platform]:'草稿' }));
    setChecks((old) => ({ ...old,[platform]:[false,false,false] }));
    setDraftDirty(true);
  };

  const updateCardPlan = (index,field,value) => {
    const currentPlan = drafts[platform]?.cardPlan || [];
    if (index < 0 || index >= currentPlan.length) return;
    const nextPlan = currentPlan.map((card,cardIndex) => cardIndex === index ? {...card,[field]:value} : card);
    updateDraft('cardPlan',nextPlan);
  };

  const addCardPlanItem = () => {
    const currentPlan = drafts[platform]?.cardPlan || [];
    if (currentPlan.length >= 5) return;
    updateDraft('cardPlan',[...currentPlan,{role:'concept',headline:'新卡片标题',keyPoints:['填写一个清晰要点'],visualDirection:'填写简短画面说明'}]);
  };

  const removeCardPlanItem = (index) => {
    const currentPlan = drafts[platform]?.cardPlan || [];
    if (currentPlan.length <= 3) return;
    updateDraft('cardPlan',currentPlan.filter((_card,cardIndex) => cardIndex !== index));
  };

  const updateCheck = async (index,value) => {
    if (!selectedTopic || !drafts[platform]) return;
    const nextChecks = (checks[platform] || [false,false,false]).map((item,i) => i === index ? value : item);
    setChecks((old) => ({ ...old,[platform]:nextChecks }));
    setDrafts((old) => ({ ...old,[platform]:{ ...old[platform],checks:nextChecks } }));
    try {
      const draft = await performApiAction('draft:checks',() => api.saveDraft(selectedTopic.id,platform,{ ...drafts[platform],checks:nextChecks }));
      syncDraftToTopic(selectedTopic.id,platform,draft);
    } catch (error) { handleApiError(error); }
  };

  const approvePlatform = async () => {
    if (!selectedTopic || !drafts[platform]) return;
    if (!checks[platform]?.every(Boolean)) { messageApi.warning('请先完成事实、表达和图片三项核对'); return; }
    try {
      await api.saveDraft(selectedTopic.id,platform,{ ...drafts[platform],checks:checks[platform] });
      const approved = await api.approveDraft(selectedTopic.id,platform,checks[platform]);
      syncDraftToTopic(selectedTopic.id,platform,approved);
      setDraftDirty(false);
      showSuccess(`${platform}版本已审核，可复制发布`);
    } catch (error) { handleApiError(error); }
  };

  const openPublishForm = async () => {
    try {
      const saved = await saveCurrentDraft();
      const current = saved || drafts[platform];
      if (!current || !['已审核','已发布'].includes(current.status)) {
        messageApi.warning('当前稿件有未审核的修改，请重新审核后登记发布');
        return;
      }
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(({type,value}) => [type,value]));
      const today = `${parts.year}-${parts.month}-${parts.day}`;
      publishForm.setFieldsValue({publishedOn:today,publishedTime:'',publishUrl:'',note:'',assetIds:(current.assets || []).map((asset) => asset.id),requestKey:crypto.randomUUID()});
      setPublishOpen(true);
    } catch (error) { handleApiError(error); }
  };

  const markPublished = async (values,allowDuplicate = false) => {
    try {
      const saved = await saveCurrentDraft();
      if (saved && !['已审核','已发布'].includes(saved.status)) {
        messageApi.warning('当前稿件有未审核的修改，请重新审核后登记发布');
        return;
      }
      const result = await api.publishDraft(selectedTopic.id,platform,{
        publishedOn:values.publishedOn,publishedTime:values.publishedTime || null,
        publishUrl:values.publishUrl || null,note:values.note || '',assetIds:values.assetIds || [],
        requestKey:values.requestKey,allowDuplicate,
      });
      syncDraftToTopic(selectedTopic.id,platform,result.draft);
      setPublishOpen(false);
      publishForm.resetFields();
      go('content',{view:'publications',topicId:selectedTopic.id});
      showSuccess('已新增一条发布记录');
      try { await reloadDashboard(); }
      catch { messageApi.warning('发布记录已保存，但统计刷新失败，稍后刷新页面即可'); }
    } catch (error) {
      if (error.status === 409 && /同一天已有相同链接/.test(error.message) && !allowDuplicate) {
        Modal.confirm({title:'可能重复登记',content:'同一天已有相同链接的发布记录。确认这是另一次实际发布吗？',okText:'仍要新增',cancelText:'取消',cancelButtonProps:{color:'danger',variant:'outlined'},onOk:() => performApiAction('draft:publish',() => markPublished(values,true))});
      } else handleApiError(error);
    }
  };

  const openTopicSuggestions = () => {
    setSuggestions([]);
    setSuggestionsGenerated(false);
    setSuggestionsOpen(true);
  };

  const loadSuggestions = async ({ excludeCurrent = false } = {}) => {
    try {
      const result = await api.suggestTopics(suggestionInsuranceType,excludeCurrent ? suggestions.map((item) => item.title) : []);
      const nextSuggestions = result.topics || [];
      if (!nextSuggestions.length && excludeCurrent) {
        messageApi.info('这批暂时没有新主题，已保留当前候选；可以再试一次');
        return;
      }
      setSuggestions(nextSuggestions);
      setSuggestionsGenerated(nextSuggestions.length > 0);
      messageApi.info(result.provider === 'demo' ? '当前为示例候选；配置 GPT 后将结合匿名高频问题生成' : `已由 GPT 推荐选题（${result.provider}）`);
    } catch (error) { handleApiError(error); }
  };

  const createTopicFromSuggestion = async (suggestion) => {
    try {
      const topic = await api.createTopic({ title:suggestion.title,category:suggestion.category,insuranceType:suggestion.insuranceType || suggestionInsuranceType,platforms:channelNames });
      setTopics((old) => [topic,...old]);
      chooseTopic(topic);
      setSuggestionsOpen(false);
      go('content');
      showSuccess('选题已加入内容池');
    } catch (error) { handleApiError(error); }
  };

  const updateSchedule = async (values) => {
    try {
      const updated = await api.updateSettings({ content:{ autoEnabled:Boolean(values.autoEnabled),frequencyDays:Number(values.frequencyDays),runAt:values.runAt } });
      setSettings(updated);
      setScheduleOpen(false);
      showSuccess(values.autoEnabled ? '自动生成计划已保存' : '自动生成已暂停');
    } catch (error) { handleApiError(error); }
  };

  const updateVoice = async (values) => {
    try {
      const updated = await api.updateSettings({ content:{ voice:values.voice } });
      setSettings(updated);
      setVoiceOpen(false);
      showSuccess('表达设定已保存');
    } catch (error) { handleApiError(error); }
  };

  const confirmDeleteVoice = () => Modal.confirm({
    title:'删除表达设定？',
    content:'这会清空自定义写作要求，内容生成将继续使用“大话保险”的默认表达规则。',
    okText:'删除设定',
    cancelText:'保留',
    okButtonProps:{color:'danger',variant:'outlined'},
    cancelButtonProps:{color:'danger',variant:'outlined'},
    onOk:() => performApiAction('settings:voice:delete',async () => {
      try {
        const updated = await api.updateSettings({content:{voice:''}});
        setSettings(updated);
        voiceForm.setFieldsValue({voice:''});
        setVoiceOpen(false);
        showSuccess('自定义表达设定已删除');
      } catch (error) {
        handleApiError(error);
        return false;
      }
      return undefined;
    }),
  });

  const openImageStyles = () => {
    const imageStyles = settings.content?.imageStyles || defaultImageStyles;
    imageStylesForm.setFieldsValue({
      xhs:{ ...defaultImageStyles.xhs,...imageStyles.xhs },
      article:{ ...defaultImageStyles.article,...imageStyles.article },
      xhsImageMode:settings.content?.xhsImageMode || defaultXhsImageMode,
      wechatTheme:settings.content?.wechatTheme || 'clean',
    });
    setImageStylesOpen(true);
  };

  const updateImageStyles = async (values) => {
    try {
      const { wechatTheme,xhsImageMode,...imageStyles } = values;
      const updated = await api.updateSettings({ content:{ imageStyles,wechatTheme,xhsImageMode } });
      setSettings(updated);
      setImageStylesOpen(false);
      showSuccess('平台图文样式已保存');
    } catch (error) { handleApiError(error); }
  };

  const uploadImage = async (file) => {
    if (!selectedTopic) { messageApi.warning('请先选择一个选题'); return; }
    setAssetBusy(true);
    try {
      const asset = await api.uploadAsset(selectedTopic.id,platform,file);
      const draft = { ...drafts[platform],assets:[...(drafts[platform]?.assets || []),asset],status:'草稿',checks:[false,false,false] };
      syncDraftToTopic(selectedTopic.id,platform,draft);
      messageApi.success('图片已上传并保存，可预览或下载');
    } catch (error) { handleApiError(error); }
    finally { setAssetBusy(false); }
  };

  const generateImage = async () => {
    if (!selectedTopic || !drafts[platform]?.body?.trim()) {
      messageApi.warning('请先生成这个平台的草稿');
      return;
    }
    setAssetBusy(true);
    try {
      await saveCurrentDraft();
      const configuredStyles = settings.content?.imageStyles || defaultImageStyles;
      const imageOptions = platform === '小红书' ? configuredStyles.xhs : configuredStyles.article;
      const result = await api.generateImage(selectedTopic.id,platform,imageOptions);
      const assets = result.assets?.length ? result.assets : [result];
      const draft = { ...drafts[platform],assets:[...(drafts[platform]?.assets || []),...assets],status:'草稿',checks:[false,false,false] };
      syncDraftToTopic(selectedTopic.id,platform,draft);
      messageApi.success(`baoyu ${result.skill === 'baoyu-xhs-images' ? '小红书图卡' : '文章插画'}已生成 ${assets.length} 张`);
    } catch (error) { handleApiError(error); }
    finally { setAssetBusy(false); }
  };

  const switchPlatform = async (nextPlatform) => {
    try { await saveCurrentDraft(); setPlatform(nextPlatform); }
    catch (error) { handleApiError(error); }
  };

  const downloadAsset = (asset) => performApiAction(`asset:download:${asset.id}`, () => api.downloadAsset(asset.id, asset.fileName)).catch(handleApiError);

  const removeAsset = (asset) => Modal.confirm({
    title:'从当前图文预览中移除这张图片？',
    content:'该平台稿件会退回草稿状态并需要重新审核。已关联的发布记录会继续保留这张图片。',
    okText:'移除图片',
    cancelText:'取消',
    okButtonProps:{color:'danger',variant:'outlined'},
    cancelButtonProps:{color:'danger',variant:'outlined'},
    onOk:() => performApiAction(`asset:delete:${asset.id}`,async () => {
      const result = await api.deleteAsset(asset.id);
      const currentAssets = drafts[platform]?.assets || [];
      const removedIndex = currentAssets.findIndex((item) => item.id === asset.id);
      const assets = currentAssets.filter((item) => item.id !== asset.id);
      syncDraftToTopic(selectedTopic.id,platform,{...drafts[platform],assets,status:'草稿',checks:[false,false,false]});
      setImagePreviewIndex((index) => {
        if (assets.length === 0) return 0;
        if (removedIndex >= 0 && removedIndex < index) return index - 1;
        if (removedIndex === index) return Math.min(index,assets.length - 1);
        return index;
      });
      if (imagePreviewOpen && assets.length === 0) setImagePreviewOpen(false);
      showSuccess(result.preservedForHistory ? '已从当前预览移除，历史发布记录中的图片已保留' : '图片已删除');
    }).catch(handleApiError),
  });

  const downloadAssetsAsZip = (assets, archiveName) => performApiAction('assets:download-zip', async () => {
    if (!assets?.length) throw new Error('当前没有可下载的图片');
    const files = await Promise.all(assets.map(async (asset, index) => {
      const response = await fetch(api.asset(asset.id, true));
      if (!response.ok) throw new Error(`${asset.fileName || `第 ${index + 1} 张图片`}下载失败（HTTP ${response.status}）`);
      return { fileName: asset.fileName, blob: await response.blob() };
    }));
    const archive = await createStoredZipBlob(files);
    const url = URL.createObjectURL(archive);
    const link = document.createElement('a');
    link.href = url;
    link.download = archiveName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    showSuccess(`已打包下载 ${files.length} 张图片`);
  }).catch(handleApiError);


  useEffect(() => {
    if (!draftDirty || !selectedTopic || !drafts[platform]) return undefined;
    const timer = setTimeout(async () => {
      try { await saveCurrentDraft(); }
      catch (error) { messageApi.error(error.message); }
    }, 700);
    return () => clearTimeout(timer);
  }, [draftDirty, drafts, platform, selectedTopic?.id]);

  return { syncDraftToTopic, saveCurrentDraft, chooseTopic, createTopic, confirmDeleteTopic, generateDrafts, humanizeDraft, generateCardPlan, updateDraft, updateCardPlan, addCardPlanItem, removeCardPlanItem, updateCheck, approvePlatform, markPublished, openPublishForm, openTopicSuggestions, loadSuggestions, createTopicFromSuggestion, updateSchedule, updateVoice, confirmDeleteVoice, openImageStyles, updateImageStyles, uploadImage, generateImage, switchPlatform, downloadAsset, removeAsset, downloadAssetsAsZip };
}

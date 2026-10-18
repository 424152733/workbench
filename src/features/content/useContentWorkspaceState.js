import { useState } from 'react';
import { Form } from 'antd';

export function useContentWorkspaceState() {
  const [topics, setTopics] = useState([]);
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [topicModalOpen, setTopicModalOpen] = useState(false);
  const [topicForm] = Form.useForm();
  const [platform, setPlatform] = useState('知乎');
  const [drafts, setDrafts] = useState({});
  const [platformStatus, setPlatformStatus] = useState({});
  const [checks, setChecks] = useState({});
  const [humanized, setHumanized] = useState({});
  const [draftDirty, setDraftDirty] = useState(false);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleForm] = Form.useForm();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceForm] = Form.useForm();
  const [imageStylesOpen, setImageStylesOpen] = useState(false);
  const [imageStylesForm] = Form.useForm();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionInsuranceType, setSuggestionInsuranceType] = useState('不限');
  const [suggestionsGenerated, setSuggestionsGenerated] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishForm] = Form.useForm();
  const [assetBusy, setAssetBusy] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [imagePreviewIndex, setImagePreviewIndex] = useState(0);
  const [articlePreviewOpen, setArticlePreviewOpen] = useState(false);

  return {
    topics,setTopics,selectedTopic,setSelectedTopic,topicModalOpen,setTopicModalOpen,topicForm,platform,setPlatform,
    drafts,setDrafts,platformStatus,setPlatformStatus,checks,setChecks,humanized,setHumanized,draftDirty,setDraftDirty,
    generationBusy,setGenerationBusy,scheduleOpen,setScheduleOpen,scheduleForm,voiceOpen,setVoiceOpen,voiceForm,
    imageStylesOpen,setImageStylesOpen,imageStylesForm,suggestionsOpen,setSuggestionsOpen,suggestions,setSuggestions,
    suggestionInsuranceType,setSuggestionInsuranceType,suggestionsGenerated,setSuggestionsGenerated,publishOpen,
    setPublishOpen,publishForm,assetBusy,setAssetBusy,imagePreviewOpen,setImagePreviewOpen,imagePreviewIndex,
    setImagePreviewIndex,articlePreviewOpen,setArticlePreviewOpen,
  };
}

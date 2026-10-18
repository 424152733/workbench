import { useCallback, useEffect, useState } from 'react';

export function useProductCenterWorkspace({api,performApiAction,messageApi}) {
  const [meta,setMeta] = useState({companies:[],insuranceTypes:[]});
  const [platformSettings,setPlatformSettings] = useState([]);
  const [products,setProducts] = useState([]);
  const [selectedProductId,setSelectedProductId] = useState(null);
  const [workspace,setWorkspace] = useState(null);
  const [activeDocumentId,setActiveDocumentId] = useState(null);
  const [activeExtractionId,setActiveExtractionId] = useState(null);
  const [platform,setPlatform] = useState('知乎');
  const [pageLoading,setPageLoading] = useState(true);
  const [pageError,setPageError] = useState('');

  const showError = (error) => messageApi.error(error?.message || '操作失败，请稍后重试');
  const runAction = async (key,action,after) => {
    try {
      const value = await performApiAction(key,action);
      if (after) await after(value);
      return value;
    } catch (error) {
      showError(error);
      return null;
    }
  };

  const loadIndex = useCallback(async ({selectId = selectedProductId}={}) => {
    setPageError('');
    try {
      const [nextMeta,nextProducts,nextPlatformSettings] = await performApiAction('product-center:index',() => Promise.all([
        api.productCenterMeta(),api.productCenterProducts(),api.productCenterPlatformSettings(),
      ]));
      setMeta(nextMeta);
      setProducts(nextProducts);
      setPlatformSettings(nextPlatformSettings);
      const nextId = nextProducts.some((item) => Number(item.id) === Number(selectId)) ? Number(selectId) : Number(nextProducts[0]?.id) || null;
      setSelectedProductId(nextId);
      if (nextId) {
        const nextWorkspace = await performApiAction('product-center:workspace',() => api.productCenterWorkspace(nextId));
        setWorkspace(nextWorkspace);
        setActiveDocumentId((current) => nextWorkspace.documents.some((item) => item.id === current) ? current : nextWorkspace.documents[0]?.id || null);
        setActiveExtractionId((current) => nextWorkspace.extractions.some((item) => item.id === current) ? current : nextWorkspace.extractions[0]?.id || null);
      } else {
        setWorkspace(null);
        setActiveDocumentId(null);
        setActiveExtractionId(null);
      }
      return nextId;
    } catch (error) {
      setPageError(error?.message || '无法加载产品中心');
      throw error;
    }
  },[api,performApiAction,selectedProductId]);

  useEffect(() => {
    let live = true;
    performApiAction('product-center:index',() => Promise.all([api.productCenterMeta(),api.productCenterProducts(),api.productCenterPlatformSettings()]))
      .then(async ([nextMeta,nextProducts,nextPlatformSettings]) => {
        if (!live) return;
        setMeta(nextMeta);
        setProducts(nextProducts);
        setPlatformSettings(nextPlatformSettings);
        const firstId = Number(nextProducts[0]?.id) || null;
        setSelectedProductId(firstId);
        if (firstId) {
          const nextWorkspace = await performApiAction('product-center:workspace',() => api.productCenterWorkspace(firstId));
          if (!live) return;
          setWorkspace(nextWorkspace);
          setActiveDocumentId(nextWorkspace.documents[0]?.id || null);
          setActiveExtractionId(nextWorkspace.extractions[0]?.id || null);
        }
      })
      .catch((error) => { if (live) setPageError(error?.message || '无法加载产品中心'); })
      .finally(() => { if (live) setPageLoading(false); });
    return () => { live = false; };
  },[api,performApiAction]);

  const selectProduct = (productId) => {
    setSelectedProductId(Number(productId));
    setWorkspace(null);
    setActiveDocumentId(null);
    setActiveExtractionId(null);
    return runAction('product-center:workspace',() => api.productCenterWorkspace(productId),(nextWorkspace) => {
    setWorkspace(nextWorkspace);
    setActiveDocumentId(nextWorkspace.documents[0]?.id || null);
    setActiveExtractionId(nextWorkspace.extractions[0]?.id || null);
    });
  };

  const createProduct = (values) => runAction('product-center:create',() => api.createInsuranceProduct(values),async (product) => {
    const nextId = Number(product.id);
    await loadIndex({selectId:nextId}).catch(() => null);
    messageApi.success('新华保险产品档案已创建');
  });

  const updateProduct = (values) => {
    if (!selectedProductId) return Promise.resolve(null);
    return runAction('product-center:update',() => api.updateInsuranceProduct(selectedProductId,values),async () => {
      await loadIndex({selectId:selectedProductId}).catch(() => null);
      messageApi.success('产品档案已保存');
    });
  };

  const deleteProduct = () => {
    if (!selectedProductId) return Promise.resolve(null);
    const deletedId = selectedProductId;
    return runAction(`product-center:delete:${deletedId}`,async () => {
      const result = await api.deleteInsuranceProduct(deletedId);
      setProducts((current) => current.filter((item) => Number(item.id) !== Number(deletedId)));
      setSelectedProductId(null);
      setWorkspace(null);
      setActiveDocumentId(null);
      setActiveExtractionId(null);
      await loadIndex({selectId:null}).catch(() => null);
      return result;
    },async (result) => {
      messageApi.success(`产品及关联资料、${result.deletedExtractions} 份要点和 ${result.deletedDrafts} 篇文案已删除`);
    });
  };

  const uploadDocument = (file,documentType) => {
    if (!selectedProductId) return Promise.resolve(null);
    return runAction('product-center:upload',async () => {
      const document = await api.uploadProductDocument(selectedProductId,file,documentType);
      const nextWorkspace = await api.productCenterWorkspace(selectedProductId);
      return {document,nextWorkspace};
    },({document,nextWorkspace}) => {
      setWorkspace(nextWorkspace);
      setActiveDocumentId(document.id);
      if (document.parseStatus === 'parsed') messageApi.success('资料已上传并完成文字提取');
      else messageApi.warning(document.parseError || '资料已上传，但需要检查提取结果');
    });
  };

  const deleteDocument = (documentId) => runAction(`product-center:document:delete:${documentId}`,async () => {
    const result = await api.deleteProductDocument(documentId);
    let nextWorkspace;
    try {
      nextWorkspace = await api.productCenterWorkspace(selectedProductId);
    } catch {
      const deletedExtractionIds = new Set((workspace?.extractions || []).filter((item) => Number(item.documentId) === Number(documentId)).map((item) => Number(item.id)));
      nextWorkspace = workspace ? {
        ...workspace,
        documents:workspace.documents.filter((item) => Number(item.id) !== Number(documentId)),
        extractions:workspace.extractions.filter((item) => !deletedExtractionIds.has(Number(item.id))),
        drafts:workspace.drafts.filter((item) => !deletedExtractionIds.has(Number(item.extractionId))),
      } : null;
      messageApi.warning('资料已删除，但工作区刷新失败；请稍后刷新确认。');
    }
    if (!nextWorkspace) return {result,nextWorkspace:null};
    return {result,nextWorkspace};
  },({result,nextWorkspace}) => {
    setWorkspace(nextWorkspace);
    setActiveDocumentId(nextWorkspace?.documents[0]?.id || null);
    setActiveExtractionId(nextWorkspace?.extractions[0]?.id || null);
    messageApi.success(`资料及关联的 ${result.deletedExtractions} 份要点、${result.deletedDrafts} 篇文案已删除`);
  });

  const analyzeDocument = (documentId) => runAction(`product-center:analyze:${documentId}`,async () => {
    const extraction = await api.analyzeProductDocument(documentId);
    const nextWorkspace = await api.productCenterWorkspace(selectedProductId);
    return {extraction,nextWorkspace};
  },({extraction,nextWorkspace}) => {
    setWorkspace(nextWorkspace);
    setActiveDocumentId(Number(documentId));
    setActiveExtractionId(extraction.id);
    messageApi.success('产品要点已提取，请逐条核对资料出处');
  });

  const updateExtraction = (extractionId,facts) => runAction(`product-center:extraction:save:${extractionId}`,async () => {
    const extraction = await api.updateProductExtraction(extractionId,facts);
    const nextWorkspace = await api.productCenterWorkspace(selectedProductId);
    return {extraction,nextWorkspace};
  },({extraction,nextWorkspace}) => {
    setWorkspace(nextWorkspace);
    setActiveExtractionId(extraction.id);
    messageApi.success('产品要点已保存，需重新确认后才能生成文案');
  });

  const confirmExtraction = (extractionId) => runAction(`product-center:extraction:confirm:${extractionId}`,async () => {
    const extraction = await api.confirmProductExtraction(extractionId);
    const nextWorkspace = await api.productCenterWorkspace(selectedProductId);
    return {extraction,nextWorkspace};
  },({extraction,nextWorkspace}) => {
    setWorkspace(nextWorkspace);
    setActiveExtractionId(extraction.id);
    messageApi.success('产品要点已确认，可以生成平台文案');
  });

  const generateDraft = (extractionId,targetPlatform) => runAction(`product-center:draft:generate:${targetPlatform}`,async () => {
    const draft = await api.generateProductCopyDraft(extractionId,targetPlatform);
    return draft;
  },(draft) => {
    setWorkspace((current) => current ? {...current,drafts:[draft,...current.drafts.filter((item) => item.id !== draft.id)]} : current);
    messageApi.success(`${targetPlatform}产品解读文案已生成并完成大白话润色`);
  });

  const saveDraft = (draftId,values) => runAction(`product-center:draft:save:${draftId}`,() => api.saveProductCopyDraft(draftId,values),(draft) => {
    setWorkspace((current) => current ? {...current,drafts:current.drafts.map((item) => item.id === draft.id ? draft : item)} : current);
    messageApi.success('文案草稿已保存');
  });

  const approveDraft = (draftId,checks) => runAction(`product-center:draft:approve:${draftId}`,() => api.approveProductCopyDraft(draftId,checks),(draft) => {
    setWorkspace((current) => current ? {...current,drafts:current.drafts.map((item) => item.id === draft.id ? draft : item)} : current);
    messageApi.success('文案已审核，可以复制到平台发布');
  });

  const updatePlatformSettings = (targetPlatform,values) => runAction(`product-center:platform-settings:update:${targetPlatform}`,() => api.updateProductPlatformSettings(targetPlatform,values),(setting) => {
    setPlatformSettings((current) => [...current.filter((item) => item.platform !== targetPlatform),setting]);
    messageApi.success(`${targetPlatform}表达设置已保存`);
  });

  const loadDraftVersions = (draftId) => runAction(`product-center:draft:versions:${draftId}`,() => api.productCopyDraftVersions(draftId));

  const restoreDraftVersion = (draftId,version) => runAction(`product-center:draft:restore:${draftId}`,async () => {
    const draft = await api.restoreProductCopyDraftVersion(draftId,version);
    const nextWorkspace = await api.productCenterWorkspace(selectedProductId);
    return {draft,nextWorkspace};
  },({draft,nextWorkspace}) => {
    setWorkspace(nextWorkspace);
    messageApi.success(`已恢复为历史版本 v${version}，请重新审核后复制`);
    return draft;
  });

  return {
    meta,platformSettings,products,selectedProductId,workspace,activeDocumentId,setActiveDocumentId,activeExtractionId,setActiveExtractionId,
    platform,setPlatform,pageLoading,pageError,loadIndex,selectProduct,createProduct,updateProduct,deleteProduct,
    uploadDocument,deleteDocument,analyzeDocument,updateExtraction,confirmExtraction,generateDraft,saveDraft,approveDraft,
    updatePlatformSettings,loadDraftVersions,restoreDraftVersion,
  };
}

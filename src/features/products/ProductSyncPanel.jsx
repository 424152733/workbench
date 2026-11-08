import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Progress, Space, Tag, Typography, message } from 'antd';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';

const { Text } = Typography;
const activeStatus = (status) => status==='queued' || status==='running';
const phaseLabel = (phase) => ({
  queued:'等待开始',reading_official_catalog:'读取官网在售目录',saving_products:'更新产品档案与资料链接',
  success:'同步完成',partial_success:'部分完成',failed:'同步失败',
}[phase] || phase || '等待同步');
const statusColor = (status) => status==='success' ? 'green' : status==='partial_success' ? 'orange' : status==='failed' ? 'red' : 'blue';
const initialRuns = (companies) => Object.fromEntries(companies.filter((company)=>company.latestRun?.id)
  .map((company)=>[company.code,{...company.latestRun,companyCode:company.code,company:company.label}]));

export function ProductSyncPanel({companies=[],api,performApiAction,apiLoading={},onUpdated}) {
  const [runs,setRuns]=useState(()=>initialRuns(companies));
  const [notice,setNotice]=useState(null);
  const runsRef=useRef(runs);
  const onUpdatedRef=useRef(onUpdated);
  const completedRef=useRef(new Set());
  useEffect(()=>{runsRef.current=runs;},[runs]);
  useEffect(()=>{onUpdatedRef.current=onUpdated;},[onUpdated]);
  useEffect(()=>{
    const pending=initialRuns(companies);
    if (Object.keys(pending).length) setRuns((current)=>({...pending,...current}));
  },[companies]);
  useEffect(()=>{
    let live=true;
    Promise.all(companies.filter((company)=>company.latestRun?.id).map(async(company)=>{
      try { return await api.productSyncRun(company.latestRun.id); } catch { return null; }
    })).then((latest)=>{
      if (!live) return;
      setRuns((current)=>{
        const next={...current};
        for (const run of latest.filter(Boolean)) next[run.companyCode]={...current[run.companyCode],...run};
        runsRef.current=next;
        return next;
      });
    });
    return ()=>{live=false;};
  },[api,companies]);
  useEffect(()=>{
    let disposed=false; let timer;
    const poll=async()=>{
      const active=Object.values(runsRef.current).filter((run)=>activeStatus(run.status));
      if (!active.length) return;
      const updated=await Promise.all(active.map(async(run)=>{
        try { return await api.productSyncRun(run.id); }
        catch(error) { return {...run,status:'failed',phase:'failed',errors:[{message:error?.message || '无法读取同步状态'}]}; }
      }));
      if (disposed) return;
      const newlyCompleted=updated.filter((run)=>!activeStatus(run.status) && !completedRef.current.has(run.id));
      for (const run of newlyCompleted) completedRef.current.add(run.id);
      setRuns((current)=>{
        const next={...current};
        for (const run of updated) {
          next[run.companyCode]={...current[run.companyCode],...run};
        }
        runsRef.current=next;
        return next;
      });
      if (newlyCompleted.length) onUpdatedRef.current?.();
      if (Object.values(runsRef.current).some((run)=>activeStatus(run.status))) timer=setTimeout(poll,2500);
    };
    if (Object.values(runs).some((run)=>activeStatus(run.status))) timer=setTimeout(poll,1200);
    return ()=>{disposed=true; clearTimeout(timer);};
  },[api,runs]);

  const startSync=async(companyCodes)=>{
    const key=companyCodes.length===1?`product-center:sync:${companyCodes[0]}`:'product-center:sync:all';
    setNotice(null);
    try {
      const result=await performApiAction(key,()=>api.startProductSync(companyCodes));
      const next=Object.fromEntries(result.runs.map((run)=>[run.companyCode,run]));
      setRuns((current)=>({...current,...next}));
      const started=result.runs.filter((run)=>activeStatus(run.status)).length;
      if (!started) setNotice({type:'info',text:'所选公司的最新同步任务已在运行中。'});
    } catch(error) {
      setNotice({type:'error',text:error?.message || '无法发起产品同步'});
    }
  };

  const toggleCompany=async(company,checked)=>{
    try {
      await performApiAction(`product-center:company:${company.code}`,()=>api.updateProductSyncCompany(company.code,checked));
      message.success(`${company.label}已${checked?'加入':'暂停'}同步`);
      onUpdated?.();
    } catch(error) { message.error(error?.message || '公司同步设置保存失败'); }
  };
  const enabledCompanies=companies.filter((company)=>company.syncSupported && company.syncEnabled);

  return <Card className="product-sync-panel product-panel" title="官网在售产品同步" extra={<Button size="small" type="primary" icon={<SyncOutlined />} disabled={!enabledCompanies.length}
    loading={Boolean(apiLoading['product-center:sync:all'])} onClick={()=>startSync(enabledCompanies.map((company)=>company.code))}>同步全部已启用公司</Button>}>
    <div className="product-sync-intro">
      <Text type="secondary">从保险公司官网在售目录更新个人产品和官方资料链接。可从官网查看或按需导入 PDF；官网状态不代表当前渠道可售。</Text>
      <Button size="small" icon={<ReloadOutlined />} onClick={()=>onUpdated?.()}>刷新状态</Button>
    </div>
    {notice ? <Alert className="product-sync-notice" type={notice.type} showIcon message={notice.text} closable onClose={()=>setNotice(null)} /> : null}
    <div className="product-sync-companies">
      {companies.map((company)=>{
        const run=runs[company.code] || company.latestRun;
        const isActive=activeStatus(run?.status);
        const supported=company.syncSupported;
        return <div className="product-sync-company" key={company.code}>
          <div className="product-sync-company-heading">
            <div><strong>{company.label}</strong><Tag color={supported?'green':'default'}>{supported?'官网已接入':'待接入'}</Tag></div>
            <Checkbox checked={company.syncEnabled} disabled={!supported || Boolean(apiLoading[`product-center:company:${company.code}`])}
              onChange={(event)=>toggleCompany(company,event.target.checked)}>纳入批量同步</Checkbox>
          </div>
          <Text className="product-sync-coverage" type="secondary">{company.syncCoverage || '完成官网目录核验后开放同步'}</Text>
          {run ? <div className="product-sync-run">
            <Space size={6}><Tag color={statusColor(run.status)}>{phaseLabel(run.phase || run.status)}</Tag>
              {run.finishedAt ? <Text type="secondary">{new Date(run.finishedAt).toLocaleString('zh-CN',{hour12:false})}</Text> : null}</Space>
            {isActive ? <Progress className="product-sync-progress" size="small" status="active" showInfo={false} /> : null}
            {!isActive && run.status!=='failed' ? <Text type="secondary">新增 {run.importedCount || 0} · 更新 {run.updatedCount || 0} · 资料链接 {run.materialCount || 0} · 排除 {run.excludedCount || 0}</Text> : null}
            {run.errorCount>0 && run.errors?.length ? <Text className="product-sync-error" type="danger">{run.errors[0].message}{run.errorCount>1?`等 ${run.errorCount} 项`:''}</Text> : null}
          </div> : <Text className="product-sync-run-empty" type="secondary">尚无同步记录</Text>}
          <Button size="small" icon={<SyncOutlined />} disabled={!supported || !company.syncEnabled || isActive}
            loading={Boolean(apiLoading[`product-center:sync:${company.code}`])} onClick={()=>startSync([company.code])}>
            {isActive?'同步中':'同步在售产品'}
          </Button>
        </div>;
      })}
    </div>
  </Card>;
}

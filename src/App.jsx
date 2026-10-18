import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  ConfigProvider,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  Layout,
  Modal,
  Radio,
  Row,
  Select,
  Spin,
  Space,
  Statistic,
  Table,
  Tabs,
  TimePicker,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
  theme as antdTheme,
} from 'antd';
import {
  AppstoreOutlined,
  ArrowDownOutlined,
  ArrowRightOutlined,
  BellOutlined,
  CalendarOutlined,
  CheckCircleFilled,
  CheckOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  CustomerServiceOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExpandOutlined,
  FileImageOutlined,
  FileTextOutlined,
  FilterOutlined,
  HeartOutlined,
  HomeOutlined,
  LeftOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  SunOutlined,
  SyncOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { api } from './api.js';
import { isWorkbenchPage, isWorkbenchPath, pageForPath, pathForPage, pathForCustomer, pathForFamily, parseWorkbenchLocation } from './navigation.js';
import { channelNames, platformsForTopic } from './platforms.js';
import { useCustomerWorkspaceState } from './features/customers/useCustomerWorkspaceState.js';
import { useCustomerWorkspaceActions } from './features/customers/useCustomerWorkspaceActions.js';
import { useContentWorkspaceState } from './features/content/useContentWorkspaceState.js';
import { useContentWorkspaceActions } from './features/content/useContentWorkspaceActions.js';
import { useApiAction } from './hooks/useApiAction.js';
import { articleStyleOptions, articleTypeOptions, defaultImageStyles, defaultXhsImageMode, insuranceTypeOptions, paletteOptions, wechatHtmlThemes, xhsCardRoleOptions, xhsLayoutOptions, xhsStyleOptions } from './features/content/content-options.js';
import { localMonth } from './utils/date.js';
import { CustomerOverlays } from './features/customers/CustomerOverlays.jsx';
import { PolicyServiceOverlays } from './features/customers/PolicyServiceOverlays.jsx';
import { usePolicyServiceWorkspace } from './features/customers/usePolicyServiceWorkspace.js';
import { ContentOverlays } from './features/content/ContentOverlays.jsx';
import { SystemNavigation, WorkspaceBrand } from './components/SystemNavigation.jsx';
import { GlobalAddCustomerButton } from './components/GlobalAddCustomerButton.jsx';

const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage.jsx').then((module) => ({ default:module.DashboardPage })));
const ClientsPage = lazy(() => import('./features/customers/ClientsPage.jsx').then((module) => ({ default:module.ClientsPage })));
const ContentPage = lazy(() => import('./features/content/ContentPage.jsx').then((module) => ({ default:module.ContentPage })));
const ProductCenterPage = lazy(() => import('./features/products/ProductCenterPage.jsx').then((module) => ({ default:module.ProductCenterPage })));
const CustomerDetailPage = lazy(() => import('./features/customers/CustomerDetailPage.jsx').then((module) => ({ default:module.CustomerDetailPage })));
const FamilyWorkspacePage = lazy(() => import('./features/customers/FamilyWorkspacePage.jsx').then((module) => ({ default:module.FamilyWorkspacePage })));

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;


function App() {
  const [messageApi, contextHolder] = message.useMessage();
  const [themeMode,setThemeMode] = useState(() => {
    try { return localStorage.getItem('advisor-workbench-theme') === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });
  const [sidebarCollapsed,setSidebarCollapsed] = useState(false);
  const { apiLoading, performApiAction } = useApiAction();
  const initialPathRef = useRef(window.location.pathname);
  const hasNavigatedRef = useRef(false);
  const [activeNav, setActiveNav] = useState(() => pageForPath(window.location.pathname));
  const [contentView,setContentView] = useState(() => parseWorkbenchLocation(window.location).page === 'content' ? parseWorkbenchLocation(window.location).view : 'workspace');
  const [customerRouteId,setCustomerRouteId] = useState(() => parseWorkbenchLocation(window.location).customerId);
  const [familyRouteId,setFamilyRouteId] = useState(() => parseWorkbenchLocation(window.location).familyId);
  const [customerReturnFamilyId,setCustomerReturnFamilyId] = useState(() => parseWorkbenchLocation(window.location).returnFamilyId);
  const customerWorkspace = useCustomerWorkspaceState();
  const { clients,setClients,selectedClient,setSelectedClient,clientQuery,setClientQuery,sourceFilter,setSourceFilter,clientView,setClientView,followUpTaskFilter,setFollowUpTaskFilter,followUpTaskSearch,setFollowUpTaskSearch,followUpTaskPage,setFollowUpTaskPage,followUpTaskPageData,setFollowUpTaskPageData,followUpTaskModalOpen,setFollowUpTaskModalOpen,followUpTaskMode,setFollowUpTaskMode,followUpTaskCustomerId,setFollowUpTaskCustomerId,followUpTaskServiceItemId,setFollowUpTaskServiceItemId,activeFollowUpTask,setActiveFollowUpTask,followUpTaskForm,completeTaskModalOpen,setCompleteTaskModalOpen,completeTaskForm,cancelTaskModalOpen,setCancelTaskModalOpen,cancelTaskTarget,setCancelTaskTarget,cancelTaskForm,sourceOptions,setSourceOptions } = customerWorkspace;
  const [dashboard, setDashboard] = useState({ metrics: {}, tasks: [], sources: [], concerns: [] });
  const [dashboardMonth, setDashboardMonth] = useState(localMonth(new Date()));
  const [backendStatus, setBackendStatus] = useState('loading');
  const [backendError, setBackendError] = useState('');
  const serviceWorkspace = usePolicyServiceWorkspace({
    enabled:backendStatus === 'ok' && activeNav === 'clients' && clientView === 'services',
    performApiAction,messageApi,onMutation:refreshServiceDependencies,
  });
  const { clientModalOpen,setClientModalOpen,clientForm,clientEditOpen,setClientEditOpen,clientEditForm,policyModalOpen,setPolicyModalOpen,policyForm,followUpModalOpen,setFollowUpModalOpen,followUpForm } = customerWorkspace;
  const contentWorkspace = useContentWorkspaceState();
  const { topics,setTopics,selectedTopic,setSelectedTopic,topicModalOpen,setTopicModalOpen,topicForm,platform,setPlatform,drafts,setDrafts,platformStatus,setPlatformStatus,checks,setChecks,humanized,setHumanized,generationBusy,setGenerationBusy } = contentWorkspace;
  const [settings, setSettings] = useState({ content: { autoEnabled: false, frequencyDays: 2, runAt: '09:00', voice: '',imageStyles:defaultImageStyles,wechatTheme:'clean',xhsImageMode:defaultXhsImageMode }, preferences: { displayName: '保险顾问', startPage: 'home', menuPosition:'left', notifications: true } });
  const { scheduleOpen,setScheduleOpen,scheduleForm,voiceOpen,setVoiceOpen,voiceForm,imageStylesOpen,setImageStylesOpen,imageStylesForm } = contentWorkspace;
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferencesForm] = Form.useForm();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarItems, setCalendarItems] = useState([]);
  const [calendarMonth, setCalendarMonth] = useState(localMonth(new Date()));
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const { suggestionsOpen,setSuggestionsOpen,suggestions,setSuggestions,suggestionInsuranceType,setSuggestionInsuranceType,suggestionsGenerated,setSuggestionsGenerated,publishOpen,setPublishOpen,publishForm,assetBusy,setAssetBusy,imagePreviewOpen,setImagePreviewOpen,imagePreviewIndex,setImagePreviewIndex,articlePreviewOpen,setArticlePreviewOpen } = contentWorkspace;

  useEffect(() => {
    try { localStorage.setItem('advisor-workbench-theme',themeMode); } catch { /* Theme still works for this session. */ }
    document.documentElement.dataset.theme = themeMode;
  },[themeMode]);

  const reloadDashboard = async (month = dashboardMonth) => setDashboard(await api.dashboard(month));

  async function refreshServiceDependencies(customerId) {
    const [customer,summary,noticeList] = await Promise.all([
      api.customer(customerId),api.dashboard(dashboardMonth),api.notifications(),
    ]);
    setClients((old) => old.map((item) => item.id === customer.id ? customer : item));
    setSelectedClient((old) => old?.id === customer.id ? customer : old);
    setDashboard(summary);
    setNotifications(noticeList);
    if (activeNav === 'clients' && clientView === 'tasks') await customerActions.loadFollowUpTaskList();
  }

  const loadInitialData = async () => {
    try {
      const [health,sources,records,topicList,summary,userSettings,notificationList] = await Promise.all([
        api.health(),api.sources(),api.customers(),api.topics(),api.dashboard(dashboardMonth),api.settings(),api.notifications(),
      ]);
      setBackendStatus(health.status);
      setBackendError('');
      setSourceOptions(sources);
      setClients(records);
      setTopics(topicList);
      setDashboard(summary);
      setSettings(userSettings);
      setNotifications(notificationList);
      if (initialPathRef.current === '/' && !hasNavigatedRef.current) {
        go(userSettings.preferences?.startPage || 'home',{replace:true});
      }
      if (topicList[0]) {
        const topicDrafts = topicList[0].drafts || {};
        setSelectedTopic(topicList[0]);
        setPlatform(platformsForTopic(topicList[0])[0]);
        setDrafts(topicDrafts);
        setPlatformStatus(Object.fromEntries(channelNames.map((channel) => [channel,topicDrafts[channel]?.status || '草稿'])));
        setChecks(Object.fromEntries(channelNames.map((channel) => [channel,topicDrafts[channel]?.checks || [false,false,false]])));
        setHumanized(Object.fromEntries(channelNames.map((channel) => [channel,Boolean(topicDrafts[channel]?.humanized)])));
      }
      scheduleForm.setFieldsValue(userSettings.content || {});
      voiceForm.setFieldsValue({ voice:userSettings.content?.voice || '' });
      preferencesForm.setFieldsValue({...userSettings.preferences,menuPosition:userSettings.preferences?.menuPosition || 'left'});
    } catch (error) {
      setBackendStatus('offline');
      setBackendError(error.message || '无法连接工作台 API');
    }
  };

  useEffect(() => { loadInitialData(); }, []);

  useEffect(() => {
    const syncFromAddressBar = () => {
      const pathname = window.location.pathname;
      const route = parseWorkbenchLocation(window.location);
      const page = route.page;
      hasNavigatedRef.current = true;
      if (page === 'clients') setClientView(route.view);
      setContentView(page === 'content' ? route.view : 'workspace');
      setCustomerRouteId(route.customerId);
      setFamilyRouteId(route.familyId);
      setCustomerReturnFamilyId(route.returnFamilyId);
      if (!route.customerId && !route.familyId) setSelectedClient(null);
      if (!isWorkbenchPath(pathname)) {
        window.history.replaceState({page},'',pathForPage(page));
      }
      setActiveNav(page);
    };
    const initialPage = pageForPath(window.location.pathname);
    if (!isWorkbenchPath(window.location.pathname)) {
      window.history.replaceState({page:initialPage},'',pathForPage(initialPage));
    }
    window.addEventListener('popstate',syncFromAddressBar);
    return () => window.removeEventListener('popstate',syncFromAddressBar);
  },[]);

  useEffect(() => {
    if (backendStatus !== 'ok') return undefined;
    performApiAction('dashboard:month',() => reloadDashboard(dashboardMonth)).catch((error) => setBackendError(error.message));
    return undefined;
  }, [dashboardMonth]);

  useEffect(() => {
    if (backendStatus !== 'ok') return undefined;
    const refreshReminders = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const [summary,notificationList] = await Promise.all([api.dashboard(dashboardMonth),api.notifications()]);
        setDashboard(summary);
        setNotifications(notificationList);
      } catch { /* Keep the last successful reminder snapshot. */ }
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') refreshReminders(); };
    const timer = window.setInterval(refreshReminders,60_000);
    window.addEventListener('focus',refreshReminders);
    document.addEventListener('visibilitychange',onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus',refreshReminders);
      document.removeEventListener('visibilitychange',onVisibility);
    };
  },[backendStatus,dashboardMonth]);

  const go = (page,{replace = false,view,customerId,familyId,fromFamilyId,topicId,from,to} = {}) => {
    const nextPage = isWorkbenchPage(page) ? page : 'home';
    const nextPath = customerId != null ? pathForCustomer(customerId,fromFamilyId) : familyId != null ? pathForFamily(familyId) : pathForPage(nextPage);
    if (customerId == null && (customerRouteId || familyRouteId)) setSelectedClient(null);
    if (view && nextPage === 'clients') setClientView(view);
    if (nextPage === 'content') setContentView(view === 'publications' ? 'publications' : 'workspace');
    const nextClientView = view || clientView;
    const publicationQuery = new URLSearchParams({view:'publications'});
    if (topicId) publicationQuery.set('topicId',String(topicId));
    if (from) publicationQuery.set('from',from);
    if (to) publicationQuery.set('to',to);
    const nextUrl = `${nextPath}${nextPage === 'clients' && !customerId && !familyId && ['tasks','services','families','analysis'].includes(nextClientView) ? `?view=${nextClientView}` : nextPage === 'content' && view === 'publications' ? `?${publicationQuery}` : ''}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history[replace ? 'replaceState' : 'pushState']({page:nextPage},'',nextUrl);
    }
    hasNavigatedRef.current = true;
    setActiveNav(nextPage);
    setCustomerRouteId(customerId == null ? null : String(customerId));
    setFamilyRouteId(familyId == null ? null : String(familyId));
    setCustomerReturnFamilyId(customerId == null || fromFamilyId == null ? null : String(fromFamilyId));
  };
  const showSuccess = (text) => messageApi.success(text);

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      showSuccess('已复制到剪贴板');
    } catch {
      messageApi.warning('浏览器未开放剪贴板权限，请手动选择复制');
    }
  };

  const dateValue = (value) => value?.format ? value.format('YYYY-MM-DD') : value || null;
  const handleApiError = (error) => messageApi.error(error.message || '操作失败');
  useEffect(() => {
    if (backendStatus !== 'ok' || !customerRouteId) return;
    if (String(selectedClient?.id) === String(customerRouteId)) return;
    performApiAction(`customer:route:${customerRouteId}`,() => api.customer(customerRouteId))
      .then(setSelectedClient).catch(handleApiError);
  },[backendStatus,customerRouteId,selectedClient?.id]);
  const customerActions = useCustomerWorkspaceActions({
    api, performApiAction, messageApi, workspace:customerWorkspace,
    dashboardState:{dashboardMonth,setDashboard,setNotifications},
    route:{activeNav,go}, serviceWorkspace, dateValue, handleApiError,
    showSuccess, reloadDashboard, backendStatus, setBackendError,
  });
  const {
    filteredClients, openCustomer, showPolicyServices, openServiceFromDashboard,
    openPolicyReminder, scheduleServiceContact, createRenewalPolicyForService,
    saveClient, openClientEdit, saveClientEdit, changeStage, savePolicy,
    verifyPolicy, saveFollowUp, openFollowUpTaskModal, openRescheduleTaskModal,
    openCompleteTaskModal, saveFollowUpTaskForm, completeFollowUpTask,
    cancelFollowUpTask, saveCancelFollowUpTask, changeClientView,
  } = customerActions;
  const contentActions = useContentWorkspaceActions({
    api, performApiAction, messageApi, workspace:contentWorkspace, settings,
    setSettings, go, dateValue, handleApiError, showSuccess, reloadDashboard,
  });
  const {
    chooseTopic, createTopic,
    confirmDeleteTopic, generateDrafts, humanizeDraft, generateCardPlan,
    updateDraft, updateCardPlan, addCardPlanItem, removeCardPlanItem,
    updateCheck, approvePlatform, markPublished, openPublishForm, openTopicSuggestions,
    loadSuggestions, createTopicFromSuggestion, updateSchedule, updateVoice,
    confirmDeleteVoice, openImageStyles, updateImageStyles, uploadImage,
    generateImage, switchPlatform, downloadAsset, removeAsset, downloadAssetsAsZip,
  } = contentActions;
  const openPreferences = () => {
    preferencesForm.setFieldsValue({...settings.preferences,menuPosition:settings.preferences?.menuPosition || 'left'});
    setPreferencesOpen(true);
  };
  const updatePreferences = async (values) => {
    try {
      const currentStartPage = settings.preferences?.startPage || 'home';
      const updated = await api.updateSettings({ preferences:values });
      setSettings(updated);
      if ((updated.preferences?.startPage || 'home') !== currentStartPage) go(updated.preferences?.startPage || 'home');
      setPreferencesOpen(false);
      showSuccess('工作台偏好已保存');
    } catch (error) { handleApiError(error); }
  };

  const openCalendar = async () => {
    try { setCalendarItems(await api.calendar(calendarMonth)); setCalendarOpen(true); }
    catch (error) { handleApiError(error); }
  };

  const openNotifications = async () => {
    try { setNotifications(await api.notifications()); setNotificationsOpen(true); }
    catch (error) { handleApiError(error); }
  };

  const pageTitle = {
    home: ['工作首页', '今天的跟进和内容审核都在这里。'],
    clients: ['客户与保单', '线索、客户档案、保单和服务待办。'],
    content: ['大话保险', '把保险讲明白，再把每个平台的内容审核好。'],
    products: ['产品中心', '管理新华保险产品资料，整理可核对的产品解读。'],
  }[activeNav];

  const menuItems = [
    { key: 'home', icon: <HomeOutlined />, label: '工作首页' },
    { key: 'clients', icon: <TeamOutlined />, label: '客户与保单' },
    { key: 'content', icon: <FileTextOutlined />, label: '大话保险' },
    { key: 'products', icon: <DatabaseOutlined />, label: '产品中心' },
  ];
  const menuPosition = settings.preferences?.menuPosition === 'top' ? 'top' : 'left';
  const topMenuEnabled = menuPosition === 'top';

  const dashboardPageProps = { dashboard,topics,settings,setTopicModalOpen,go,dashboardMonth,apiLoading,setDashboardMonth,chooseTopic,selectedTopic,performApiAction,openCustomer,openCompleteTaskModal,openRescheduleTaskModal,clients,openServiceFromDashboard,openPolicyReminder };
  const clientPageProps = { clients,dashboard,clientView,changeClientView,filteredClients,apiLoading,clientQuery,setClientQuery,sourceFilter,setSourceFilter,sourceOptions,followUpTaskSearch,setFollowUpTaskSearch,setFollowUpTaskPage,followUpTaskFilter,setFollowUpTaskFilter,followUpTaskPageData,followUpTaskPage,topicForm,setTopicModalOpen,openTopicSuggestions,channelNames,setClientModalOpen,performApiAction,handleApiError,api,changeStage,openCustomer,openCompleteTaskModal,openRescheduleTaskModal,cancelFollowUpTask,serviceWorkspace,go,showSuccess };
  const contentPageProps = { api,contentView,selectedTopic,drafts,platform,platformStatus,checks,settings,apiLoading,generationBusy,assetBusy,imagePreviewOpen,imagePreviewIndex,articlePreviewOpen,setImagePreviewIndex,setImagePreviewOpen,downloadAsset,removeAsset,downloadAssetsAsZip,switchPlatform,generateDrafts,performApiAction,humanizeDraft,updateDraft,generateCardPlan,updateCardPlan,removeCardPlanItem,addCardPlanItem,updateCheck,copyText,approvePlatform,openImageStyles,setArticlePreviewOpen,generateImage,uploadImage,publishForm,openPublishForm,topics,dashboard,dashboardMonth,channelNames,openCalendar,setTopicModalOpen,chooseTopic,go,confirmDeleteTopic,openTopicSuggestions,scheduleForm,setScheduleOpen,voiceForm,setVoiceOpen,insuranceTypeOptions,xhsCardRoleOptions,onPublicationsChanged:reloadDashboard };
  const customerOverlayProps = { selectedClient,setSelectedClient,openClientEdit,apiLoading,performApiAction,verifyPolicy,setPolicyModalOpen,openFollowUpTaskModal,openCompleteTaskModal,openRescheduleTaskModal,cancelFollowUpTask,setFollowUpModalOpen,clientEditOpen,setClientEditOpen,clientEditForm,saveClientEdit,clientModalOpen,setClientModalOpen,clientForm,saveClient,sourceOptions,policyModalOpen,policyForm,savePolicy,followUpModalOpen,followUpForm,saveFollowUp,followUpTaskMode,followUpTaskModalOpen,setFollowUpTaskModalOpen,followUpTaskForm,saveFollowUpTaskForm,activeFollowUpTask,completeTaskModalOpen,setCompleteTaskModalOpen,completeTaskForm,completeFollowUpTask,cancelTaskModalOpen,setCancelTaskModalOpen,cancelTaskTarget,cancelTaskForm,saveCancelFollowUpTask,showCustomerDrawer:!customerRouteId && !familyRouteId };
  const contentOverlayProps = { topicModalOpen,setTopicModalOpen,topicForm,createTopic,apiLoading,performApiAction,channelNames,insuranceTypeOptions,platform,scheduleOpen,setScheduleOpen,scheduleForm,updateSchedule,settings,voiceOpen,setVoiceOpen,voiceForm,updateVoice,confirmDeleteVoice,imageStylesOpen,setImageStylesOpen,imageStylesForm,updateImageStyles,xhsStyleOptions,xhsLayoutOptions,paletteOptions,articleTypeOptions,articleStyleOptions,wechatHtmlThemes,preferencesOpen,setPreferencesOpen,preferencesForm,updatePreferences,calendarOpen,setCalendarOpen,calendarMonth,setCalendarMonth,calendarItems,setCalendarItems,api,handleApiError,topics,chooseTopic,go,notificationsOpen,setNotificationsOpen,notifications,openCustomer,suggestionsOpen,setSuggestionsOpen,suggestions,setSuggestions,suggestionInsuranceType,setSuggestionInsuranceType,suggestionsGenerated,setSuggestionsGenerated,loadSuggestions,createTopicFromSuggestion,publishOpen,setPublishOpen,publishForm,markPublished,assets:drafts[platform]?.assets || [] };


  return (
    <ConfigProvider button={{color:'primary',variant:'outlined'}} theme={{algorithm:themeMode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,token:{colorPrimary:themeMode === 'dark' ? '#57a58a' : '#287866',colorInfo:themeMode === 'dark' ? '#57a58a' : '#287866',colorSuccess:'#39886b',colorWarning:'#c18a42',colorError:'#c66c5d',borderRadius:10,controlHeight:38},components:{Button:{defaultShadow:'none',primaryShadow:'none',dangerShadow:'none'}}}}>
    <Layout className={`app-shell ${themeMode === 'dark' ? 'theme-dark' : ''} ${topMenuEnabled ? 'menu-position-top' : 'menu-position-left'}`}>
      {contextHolder}
      {!topMenuEnabled ? <Sider width={234} collapsible collapsed={sidebarCollapsed} onCollapse={setSidebarCollapsed} trigger={null} breakpoint="lg" collapsedWidth={64} className={`app-sider ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
        <WorkspaceBrand />
        <div className="sider-section-label">工作空间</div>
        <SystemNavigation placement="left" activeKey={activeNav} items={menuItems} onNavigate={go} />
        <div className="sider-bottom"><Button type={sidebarCollapsed ? 'text' : undefined} icon={<SettingOutlined />} onClick={openPreferences}>偏好设置</Button></div>
      </Sider> : null}
      <Layout className={`main-layout ${!topMenuEnabled && sidebarCollapsed ? 'is-collapsed' : ''}`}>
        <Header className={`app-header ${topMenuEnabled ? 'app-header-top-menu' : ''}`}>
          {topMenuEnabled ? <>
            <WorkspaceBrand className="app-header-brand" />
            <SystemNavigation placement="top" activeKey={activeNav} items={menuItems} onNavigate={go} />
          </> : <div className="header-leading"><Button type="text" className="sider-collapse-toggle" icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? '展开系统菜单' : '折叠系统菜单'} /><div className="breadcrumb"><AppstoreOutlined /><span>工作台</span><span className="slash">/</span><strong>{pageTitle[0]}</strong></div></div>}
          <div className="header-right"><Text className="header-date">{new Date().toLocaleDateString('zh-CN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</Text><Tooltip title={themeMode === 'dark' ? '切换到明亮主题' : '切换到黑暗主题'}><Button type="text" shape="circle" icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />} onClick={() => setThemeMode((value) => value === 'dark' ? 'light' : 'dark')} aria-label={themeMode === 'dark' ? '切换到明亮主题' : '切换到黑暗主题'} /></Tooltip><Badge dot={notifications.length > 0 && settings.preferences?.notifications}><Button type="text" shape="circle" icon={<BellOutlined />} loading={Boolean(apiLoading.notifications)} onClick={() => performApiAction('notifications',openNotifications)} aria-label="通知" disabled={!settings.preferences?.notifications} /></Badge><Avatar size={34} className="user-avatar" icon={<UserOutlined />} onClick={openPreferences} /></div>
        </Header>
        <Content className="page-content"><div className="page-title-mobile"><Text className="eyebrow">{pageTitle[0]}</Text><Text className="muted">{pageTitle[1]}</Text></div>{backendStatus === 'offline' ? <Alert style={{marginBottom:16}} type="error" showIcon message="工作台 API 暂不可用" description={`${backendError}。请在项目目录启动 npm run dev:api，并检查 PostgreSQL 连接。`} /> : null}<Suspense fallback={<div className="page-loading" aria-live="polite"><Spin /></div>}>{activeNav === 'home' ? <DashboardPage {...dashboardPageProps} /> : activeNav === 'clients' && customerRouteId ? <CustomerDetailPage customer={selectedClient?.id === Number(customerRouteId) ? selectedClient : null} loading={Boolean(apiLoading[`customer:route:${customerRouteId}`])} returnFamilyId={customerReturnFamilyId} onBack={() => customerReturnFamilyId ? go('clients',{familyId:customerReturnFamilyId}) : go('clients',{view:'customers'})} onHome={() => go('home')} onClients={() => go('clients',{view:'customers'})} onEdit={openClientEdit} onPolicy={() => setPolicyModalOpen(true)} onFollowUp={() => openFollowUpTaskModal(selectedClient)} onCompleteTask={openCompleteTaskModal} onRescheduleTask={openRescheduleTaskModal} onCancelTask={cancelFollowUpTask} onService={showPolicyServices} onVerify={verifyPolicy} serviceWorkspace={serviceWorkspace} apiLoading={apiLoading} performApiAction={performApiAction} api={api} onError={handleApiError} onSuccess={showSuccess} onCustomerUpdated={setSelectedClient} onOpenFamily={(id)=>go('clients',{familyId:id})} /> : activeNav === 'clients' && familyRouteId ? <FamilyWorkspacePage familyId={familyRouteId} api={api} apiLoading={apiLoading} performApiAction={performApiAction} onBack={() => go('clients',{view:'families'})} onHome={() => go('home')} onClients={() => go('clients',{view:'customers'})} onOpenCustomer={(id,fromFamilyId) => performApiAction(`customer:open:${id}`,()=>openCustomer(id,{fromFamilyId}))} onViewPolicyServices={showPolicyServices} serviceWorkspace={serviceWorkspace} onError={handleApiError} onSuccess={showSuccess} /> : activeNav === 'clients' ? <ClientsPage {...clientPageProps} /> : activeNav === 'content' ? <ContentPage {...contentPageProps} /> : <ProductCenterPage api={api} apiLoading={apiLoading} performApiAction={performApiAction} copyText={copyText} />}</Suspense></Content>
      </Layout>

      <CustomerOverlays workspace={customerOverlayProps} serviceWorkspace={serviceWorkspace} showPolicyServices={showPolicyServices} />
      <GlobalAddCustomerButton onClick={() => setClientModalOpen(true)} />

      <PolicyServiceOverlays workspace={serviceWorkspace} apiLoading={apiLoading}
        onScheduleContact={scheduleServiceContact} onOpenCustomer={openCustomer}
        onCreateRenewalPolicy={createRenewalPolicyForService}
        onCompleteContact={openCompleteTaskModal} onRescheduleContact={openRescheduleTaskModal} />

      <ContentOverlays workspace={contentOverlayProps} />

      <Modal title="工作台偏好" open={preferencesOpen} forceRender onCancel={() => setPreferencesOpen(false)} onOk={() => preferencesForm.submit()} confirmLoading={Boolean(apiLoading['settings:preferences'])} okText="保存偏好" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}}>
        <Form form={preferencesForm} layout="vertical" onFinish={(values) => performApiAction('settings:preferences',() => updatePreferences(values))} initialValues={{displayName:'保险顾问',startPage:'home',menuPosition:'left',notifications:true}}>
          <Form.Item name="displayName" label="显示称呼"><Input maxLength={30} /></Form.Item>
          <Form.Item name="startPage" label="打开工作台时显示"><Select options={[{value:'home',label:'工作首页'},{value:'clients',label:'客户与保单'},{value:'content',label:'大话保险'},{value:'products',label:'产品中心'}]} /></Form.Item>
          <Form.Item name="menuPosition" label="系统菜单位置"><Radio.Group optionType="button" buttonStyle="solid" options={[{value:'left',label:'左侧菜单'},{value:'top',label:'顶部菜单'}]} /></Form.Item>
          <Form.Item name="notifications" valuePropName="checked"><Checkbox>显示待办通知</Checkbox></Form.Item>
        </Form>
      </Modal>

      <Modal title="内容日历" open={calendarOpen} onCancel={() => setCalendarOpen(false)} footer={<Button onClick={() => setCalendarOpen(false)}>关闭</Button>} destroyOnHidden>
        <Space style={{marginBottom:16}}><Input type="month" value={calendarMonth} suffix={apiLoading['calendar:month'] ? <Spin size="small" /> : null} onChange={(event) => { const month=event.target.value; setCalendarMonth(month); performApiAction('calendar:month',async () => { try { setCalendarItems(await api.calendar(month)); } catch (error) { handleApiError(error); } }); }} /></Space>
        {calendarItems.length ? <div className="calendar-topic-list">{calendarItems.map((item) => <button key={item.id} className="calendar-topic" disabled={Boolean(apiLoading['draft:save'])} onClick={() => { const topic=topics.find((entry) => entry.id === item.id); if (topic) chooseTopic(topic); setCalendarOpen(false); go('content'); }}><Tag color={item.status === '待审核' ? 'gold' : 'default'}>{item.status}</Tag><Text strong>{item.date} · {item.title}</Text><Text className="schedule-meta">{item.platforms.join(' · ')} · {item.category}</Text></button>)}</div> : <Empty description="这个月还没有排期选题" />}
      </Modal>

      <Drawer title="工作通知" open={notificationsOpen} onClose={() => setNotificationsOpen(false)} size={420}>
        {notifications.length ? notifications.map((item) => <button className="notification-item" key={item.id}
          disabled={Boolean(apiLoading[`customer:open:${item.customerId}`]) || Boolean(apiLoading[`service-item:open:${item.serviceItemId}`]) || Boolean(apiLoading['draft:save'])}
          onClick={() => {
            setNotificationsOpen(false);
            if (item.type === 'followup') {
              go('clients',{view:'tasks'});
              performApiAction(`customer:open:${item.customerId}`,() => openCustomer(item.customerId));
            } else if (item.type === 'service') openServiceFromDashboard(item.serviceItemId);
            else {
              const topic = topics.find((entry) => entry.id === item.topicId);
              if (topic) chooseTopic(topic);
              go('content');
            }
          }}><Text strong>{item.title}</Text><Text>{item.detail}</Text>
          {apiLoading[`customer:open:${item.customerId}`] || apiLoading[`service-item:open:${item.serviceItemId}`] ? <Spin size="small" /> : null}
          {item.date ? <Text className="schedule-meta">{item.date}</Text> : null}</button>) : <Empty description="暂无待办通知" />}
      </Drawer>

    </Layout>
    </ConfigProvider>
  );
}


export default App;

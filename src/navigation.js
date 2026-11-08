export const pagePaths = Object.freeze({
  home: '/',
  clients: '/clients',
  content: '/content',
  products: '/products',
  workCalendar: '/work-calendar',
});

const pagesByPath = Object.freeze(Object.fromEntries(
  Object.entries(pagePaths).map(([page,path]) => [path,page]),
));

const normalizePath = (pathname) => pathname.length > 1 ? pathname.replace(/\/+$/,'') : '/';
const decodeSegment = (value) => {
  try { return decodeURIComponent(value); }
  catch { return value; }
};

export const parseWorkbenchLocation = (location) => {
  const pathname = normalizePath(location?.pathname || '/');
  const search = new URLSearchParams(location?.search || '');
  const clientMatch = pathname.match(/^\/clients\/([^/]+)$/);
  if (clientMatch) {
    const returnFamilyId = /^\d+$/.test(search.get('fromFamily') || '') ? search.get('fromFamily') : null;
    return {page:'clients',customerId:decodeSegment(clientMatch[1]),familyId:null,returnFamilyId,view:'detail'};
  }
  const familyMatch = pathname.match(/^\/families\/([^/]+)$/);
  if (familyMatch) {
    return {page:'clients',customerId:null,familyId:decodeSegment(familyMatch[1]),returnFamilyId:null,view:'families'};
  }
  const page = pagesByPath[pathname] || 'home';
  const requestedView = search.get('view');
  const requestedType = search.get('type');
  const contentTypeCode = ['insurance_education','product_explainer','customer_case'].includes(requestedType) ? requestedType : 'insurance_education';
  const requestedTopicId = search.get('topicId');
  const topicId = requestedTopicId && /^[a-zA-Z0-9-]{1,80}$/.test(requestedTopicId) ? requestedTopicId : null;
  const requestedProductId = search.get('productId');
  const productId = /^\d+$/.test(requestedProductId || '') && Number(requestedProductId) > 0 ? Number(requestedProductId) : null;
  const view = page === 'clients'
    ? (['tasks','services','families','analysis'].includes(requestedView) ? requestedView : 'customers')
    : page === 'content' && requestedView === 'publications' ? 'publications' : 'workspace';
  return {page,customerId:null,familyId:null,returnFamilyId:null,view,contentTypeCode,topicId,productId};
};

export const pageForPath = (pathname) => parseWorkbenchLocation({pathname}).page;
export const isWorkbenchPath = (pathname) => {
  const normalized = normalizePath(pathname);
  return Object.hasOwn(pagesByPath,normalized) || /^\/clients\/[^/]+$/.test(normalized) || /^\/families\/[^/]+$/.test(normalized);
};
export const isWorkbenchPage = (page) => Object.hasOwn(pagePaths,page);
export const pathForPage = (page) => pagePaths[page] || pagePaths.home;
export const pathForCustomer = (customerId,fromFamilyId=null) => `/clients/${encodeURIComponent(String(customerId))}${fromFamilyId != null && /^\d+$/.test(String(fromFamilyId)) ? `?fromFamily=${encodeURIComponent(String(fromFamilyId))}` : ''}`;
export const pathForFamily = (familyId) => `/families/${encodeURIComponent(String(familyId))}`;

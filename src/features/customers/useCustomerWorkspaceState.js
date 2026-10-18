import { useState } from 'react';
import { Form } from 'antd';
import { fallbackSourceOptions } from './customer-options.js';

export function useCustomerWorkspaceState() {
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientQuery, setClientQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('全部来源');
  const [clientView, setClientView] = useState(() => {
    const view = new URLSearchParams(window.location.search).get('view');
    return ['tasks','services','families','analysis'].includes(view) ? view : 'customers';
  });
  const [followUpTaskFilter, setFollowUpTaskFilter] = useState('pending');
  const [followUpTaskSearch, setFollowUpTaskSearch] = useState('');
  const [followUpTaskPage, setFollowUpTaskPage] = useState(1);
  const [followUpTaskPageData, setFollowUpTaskPageData] = useState({ items:[], total:0 });
  const [followUpTaskModalOpen, setFollowUpTaskModalOpen] = useState(false);
  const [followUpTaskMode, setFollowUpTaskMode] = useState('create');
  const [followUpTaskCustomerId, setFollowUpTaskCustomerId] = useState(null);
  const [followUpTaskServiceItemId,setFollowUpTaskServiceItemId] = useState(null);
  const [activeFollowUpTask, setActiveFollowUpTask] = useState(null);
  const [followUpTaskForm] = Form.useForm();
  const [completeTaskModalOpen, setCompleteTaskModalOpen] = useState(false);
  const [completeTaskForm] = Form.useForm();
  const [cancelTaskModalOpen, setCancelTaskModalOpen] = useState(false);
  const [cancelTaskTarget, setCancelTaskTarget] = useState(null);
  const [cancelTaskForm] = Form.useForm();
  const [sourceOptions, setSourceOptions] = useState(fallbackSourceOptions);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [clientForm] = Form.useForm();
  const [clientEditOpen, setClientEditOpen] = useState(false);
  const [clientEditForm] = Form.useForm();
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [policyForm] = Form.useForm();
  const [followUpModalOpen, setFollowUpModalOpen] = useState(false);
  const [followUpForm] = Form.useForm();

  return {
    clients,setClients,selectedClient,setSelectedClient,clientQuery,setClientQuery,sourceFilter,setSourceFilter,
    clientView,setClientView,followUpTaskFilter,setFollowUpTaskFilter,followUpTaskSearch,setFollowUpTaskSearch,
    followUpTaskPage,setFollowUpTaskPage,followUpTaskPageData,setFollowUpTaskPageData,followUpTaskModalOpen,
    setFollowUpTaskModalOpen,followUpTaskMode,setFollowUpTaskMode,followUpTaskCustomerId,setFollowUpTaskCustomerId,
    followUpTaskServiceItemId,setFollowUpTaskServiceItemId,
    activeFollowUpTask,setActiveFollowUpTask,followUpTaskForm,completeTaskModalOpen,setCompleteTaskModalOpen,
    completeTaskForm,cancelTaskModalOpen,setCancelTaskModalOpen,cancelTaskTarget,setCancelTaskTarget,cancelTaskForm,
    sourceOptions,setSourceOptions,clientModalOpen,setClientModalOpen,clientForm,clientEditOpen,setClientEditOpen,
    clientEditForm,policyModalOpen,setPolicyModalOpen,policyForm,followUpModalOpen,setFollowUpModalOpen,followUpForm,
  };
}

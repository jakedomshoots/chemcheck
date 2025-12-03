import Layout from "./Layout.jsx";

import Home from "./Home";

import Clients from "./Clients";

import NewClient from "./NewClient";

import NewServiceLog from "./NewServiceLog";

import CustomerDetail from "./CustomerDetail";

import History from "./History";

import WeeklyReport from "./WeeklyReport";

import RouteOptimizer from "./RouteOptimizer";

import EditClient from "./EditClient";

import ChemicalUsage from "./ChemicalUsage";

import NewChemicalUsage from "./NewChemicalUsage";

import Notes from "./Notes";

import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';

const PAGES = {
    
    Home: Home,
    
    Clients: Clients,
    
    NewClient: NewClient,
    
    NewServiceLog: NewServiceLog,
    
    CustomerDetail: CustomerDetail,
    
    History: History,
    
    WeeklyReport: WeeklyReport,
    
    RouteOptimizer: RouteOptimizer,
    
    EditClient: EditClient,
    
    ChemicalUsage: ChemicalUsage,
    
    NewChemicalUsage: NewChemicalUsage,
    
    Notes: Notes,
    
}

function _getCurrentPage(url) {
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    let urlLastPart = url.split('/').pop();
    if (urlLastPart.includes('?')) {
        urlLastPart = urlLastPart.split('?')[0];
    }

    const pageName = Object.keys(PAGES).find(page => page.toLowerCase() === urlLastPart.toLowerCase());
    return pageName || Object.keys(PAGES)[0];
}

// Create a wrapper component that uses useLocation inside the Router context
function PagesContent() {
    const location = useLocation();
    const currentPage = _getCurrentPage(location.pathname);
    
    return (
        <Layout currentPageName={currentPage}>
            <Routes>            
                
                    <Route path="/" element={<Home />} />
                
                
                <Route path="/Home" element={<Home />} />
                
                <Route path="/Clients" element={<Clients />} />
                
                <Route path="/NewClient" element={<NewClient />} />
                
                <Route path="/NewServiceLog" element={<NewServiceLog />} />
                
                <Route path="/CustomerDetail" element={<CustomerDetail />} />
                
                <Route path="/History" element={<History />} />
                
                <Route path="/WeeklyReport" element={<WeeklyReport />} />
                
                <Route path="/RouteOptimizer" element={<RouteOptimizer />} />
                
                <Route path="/EditClient" element={<EditClient />} />
                
                <Route path="/ChemicalUsage" element={<ChemicalUsage />} />
                
                <Route path="/NewChemicalUsage" element={<NewChemicalUsage />} />
                
                <Route path="/Notes" element={<Notes />} />
                
            </Routes>
        </Layout>
    );
}

export default function Pages() {
    return (
        <Router>
            <PagesContent />
        </Router>
    );
}
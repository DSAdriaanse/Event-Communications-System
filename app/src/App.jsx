import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import Layout from './Layout.jsx';
import { EventProvider } from '@/components/EventContext';
import { PinGateProvider } from '@/components/PinGate';

// Pages
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Communications from './pages/Communications';
import IncidentMap from './pages/IncidentMap';
import AideStations from './pages/AideStations';
import Frequencies from './pages/Frequencies';
import Operators from './pages/Operators';
import Assignments from './pages/Assignments';
import ResourceRequests from './pages/ResourceRequests';
import BibTracker from './pages/BibTracker';
import EventReport from './pages/EventReport';
import EventSchedule from './pages/EventSchedule';
import Discussion from './pages/Discussion';
import ConOps from './pages/ConOps';
import Documents from './pages/Documents';
import Events from './pages/Events';
import NetControl from './pages/NetControl';
import BibMobile from './pages/BibMobile';
import VolunteerMobile from './pages/VolunteerMobile';
import APIInterface from './pages/APIInterface';
import IssueBulletin from './pages/IssueBulletin';
import BulletinView from './pages/BulletinView';

const LayoutWrapper = ({ children, currentPageName }) => (
  <Layout currentPageName={currentPageName}>{children}</Layout>
);

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<LayoutWrapper currentPageName="Landing"><Landing /></LayoutWrapper>} />
      <Route path="/Landing" element={<LayoutWrapper currentPageName="Landing"><Landing /></LayoutWrapper>} />
      <Route path="/Dashboard" element={<LayoutWrapper currentPageName="Dashboard"><Dashboard /></LayoutWrapper>} />
      <Route path="/Communications" element={<LayoutWrapper currentPageName="Communications"><Communications /></LayoutWrapper>} />
      <Route path="/IncidentMap" element={<LayoutWrapper currentPageName="IncidentMap"><IncidentMap /></LayoutWrapper>} />
      <Route path="/AideStations" element={<LayoutWrapper currentPageName="AideStations"><AideStations /></LayoutWrapper>} />
      <Route path="/Frequencies" element={<LayoutWrapper currentPageName="Frequencies"><Frequencies /></LayoutWrapper>} />
      <Route path="/Operators" element={<LayoutWrapper currentPageName="Operators"><Operators /></LayoutWrapper>} />
      <Route path="/Assignments" element={<LayoutWrapper currentPageName="Assignments"><Assignments /></LayoutWrapper>} />
      <Route path="/ResourceRequests" element={<LayoutWrapper currentPageName="ResourceRequests"><ResourceRequests /></LayoutWrapper>} />
      <Route path="/BibTracker" element={<LayoutWrapper currentPageName="BibTracker"><BibTracker /></LayoutWrapper>} />
      <Route path="/EventReport" element={<LayoutWrapper currentPageName="EventReport"><EventReport /></LayoutWrapper>} />
      <Route path="/EventSchedule" element={<LayoutWrapper currentPageName="EventSchedule"><EventSchedule /></LayoutWrapper>} />
      <Route path="/Discussion" element={<LayoutWrapper currentPageName="Discussion"><Discussion /></LayoutWrapper>} />
      <Route path="/ConOps" element={<LayoutWrapper currentPageName="ConOps"><ConOps /></LayoutWrapper>} />
      <Route path="/Documents" element={<LayoutWrapper currentPageName="Documents"><Documents /></LayoutWrapper>} />
      <Route path="/Events" element={<LayoutWrapper currentPageName="Events"><Events /></LayoutWrapper>} />
      <Route path="/NetControl" element={<LayoutWrapper currentPageName="NetControl"><NetControl /></LayoutWrapper>} />
      <Route path="/BibMobile" element={<LayoutWrapper currentPageName="BibMobile"><BibMobile /></LayoutWrapper>} />
      <Route path="/VolunteerMobile" element={<VolunteerMobile />} />
      <Route path="/APIInterface" element={<LayoutWrapper currentPageName="APIInterface"><APIInterface /></LayoutWrapper>} />
      <Route path="/IssueBulletin" element={<LayoutWrapper currentPageName="IssueBulletin"><IssueBulletin /></LayoutWrapper>} />
      <Route path="/BulletinView/:id" element={<EventProvider><PinGateProvider><BulletinView /></PinGateProvider></EventProvider>} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <AppRoutes />
      </Router>
      <Toaster />
    </QueryClientProvider>
  )
}

export default App
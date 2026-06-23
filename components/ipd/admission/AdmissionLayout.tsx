import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams, NavLink } from 'react-router-dom';
import { Ward } from '../../../types';
import { useIpdContext } from '../IpdContext';
import { 
  AdmissionNoteModule, 
  DailyRoundsModule, 
  NursingStationModule, 
  LabourProgressModule, 
  OperativeNotesModule, 
  WardConsentModule, 
  DischargeSummaryModule, 
  IpdBillingModule 
} from '../../IpdDashboard'; // Assuming these remain exported from there

interface AdmissionLayoutProps {
  wards: Ward[];
}

const AdmissionLayout: React.FC<AdmissionLayoutProps> = ({ wards }) => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { 
    admissions, 
    getPatient, 
    visits, 
    clinicalTemplates, 
    consultants, 
    billingRates, 
    setTemplateModal, 
    handleUpdateAdmission, 
    onUpdateTemplates 
  } = useIpdContext();

  const [admissionsLoaded, setAdmissionsLoaded] = useState(false);

  useEffect(() => {
    // Using a simple timeout to mimic loading state since the central cloud listener fetches data
    const timer = setTimeout(() => {
      setAdmissionsLoaded(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const selectedAdmission = admissions.find(a => a.id === id);
  if (!admissionsLoaded) {
      return (
          <div className="flex-grow flex items-center justify-center h-full bg-slate-50">
             <div className="text-slate-400 font-bold uppercase tracking-widest text-sm animate-pulse">Loading Admission Data...</div>
          </div>
      );
  }

  if (!selectedAdmission) return <Navigate to="/ipd/wards" replace />;
  
  const patient = getPatient(selectedAdmission.patientId);

  const tabs = [
    { id: "admission", label: "Admission" },
    { id: "rounds", label: "Rounds" },
    { id: "nursing", label: "Nursing" },
    { id: "surgery", label: "Surgery" },
    { id: "labour", label: "Labour" },
    { id: "consent", label: "Consent" },
    { id: "discharge", label: "Discharge" },
    { id: "billing", label: "Billing" },
  ];

  return (
    <div className="flex-grow flex flex-col h-full bg-white">
      <div className="bg-slate-50 p-4 border-b border-slate-200 flex justify-between items-center">
        <div>
          <h2 className="text-xl font-black text-slate-800">{patient?.name}</h2>
          <p className="text-xs text-slate-500 font-bold uppercase">
            IPD: {selectedAdmission.id} | Bed: {wards.find((w) => w.id === selectedAdmission.wardId)?.beds.find((b) => b.id === selectedAdmission.bedId)?.number}
          </p>
        </div>
        <button onClick={() => navigate('/ipd/wards')} className="bg-slate-200 px-4 py-2 rounded-lg text-xs font-black uppercase hover:bg-slate-300 transition">Close File</button>
      </div>
      <div className="flex gap-2 p-2 bg-slate-100 border-b overflow-x-auto">
        {tabs.map((tab) => {
          if (tab.id === "labour" && patient?.type !== "obstetric" && patient?.type !== "gynecology") return null;
          return (
            <NavLink 
              key={tab.id} 
              to={`/ipd/admission/${id}/${tab.id}`} 
              className={({ isActive }) => `px-4 py-2 rounded-lg text-xs font-black uppercase whitespace-nowrap ${isActive ? "bg-white text-blue-600 shadow" : "text-slate-500 hover:bg-slate-200 transition"}`}
            >
              {tab.label}
            </NavLink>
          );
        })}
      </div>
      <div className="flex-grow overflow-y-auto p-6 bg-slate-50">
        <Routes>
          <Route path="/" element={<Navigate to="rounds" replace />} />
          <Route path="admission" element={patient ? <AdmissionNoteModule activeAdmission={selectedAdmission} onUpdateAdmission={(d) => handleUpdateAdmission(id!, d)} visits={visits} patient={patient} setTemplateModal={setTemplateModal} /> : null} />
          <Route path="rounds" element={<DailyRoundsModule activeAdmission={selectedAdmission} onUpdateAdmission={(d) => handleUpdateAdmission(id!, d)} setTemplateModal={setTemplateModal} clinicalTemplates={clinicalTemplates} consultants={consultants} />} />
          <Route path="nursing" element={<NursingStationModule activeAdmission={selectedAdmission} onUpdateAdmission={(d) => handleUpdateAdmission(id!, d)} setTemplateModal={setTemplateModal} />} />
          <Route path="labour" element={<LabourProgressModule activeAdmission={selectedAdmission} onUpdateAdmission={(d) => handleUpdateAdmission(id!, d)} />} />
          <Route path="surgery" element={<OperativeNotesModule activeAdmission={selectedAdmission} onUpdateAdmission={(d) => handleUpdateAdmission(id!, d)} billingRates={billingRates} />} />
          <Route path="consent" element={patient ? <WardConsentModule activeAdmission={selectedAdmission} onUpdateAdmission={(d) => handleUpdateAdmission(id!, d)} clinicalTemplates={clinicalTemplates} onUpdateTemplates={onUpdateTemplates} patient={patient} /> : null} />
          <Route path="discharge" element={patient ? <DischargeSummaryModule activeAdmission={selectedAdmission} onUpdateAdmission={(d) => handleUpdateAdmission(id!, d)} setTemplateModal={setTemplateModal} patient={patient} /> : null} />
          <Route path="billing" element={<IpdBillingModule activeAdmission={selectedAdmission} onUpdateAdmission={(d) => handleUpdateAdmission(id!, d)} billingRates={billingRates} setTemplateModal={setTemplateModal} />} />
        </Routes>
      </div>
    </div>
  );
};
export default AdmissionLayout;

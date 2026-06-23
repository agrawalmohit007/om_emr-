
import React, { useState, useMemo, useEffect } from 'react';
import { Patient, VisitRecord, LabOrder, SelectedTests, ClinicalTemplate, PregnancyInfo, Vitals, MedicationMasterData, AppPrintSettings, ServicePrices, HormoneReportSelection, PharmacyItem, IpdAdmission, PharmacySale, Consultant } from '../types';
import ReportPreview from './ReportPreview';
import { syncToCloud } from '../services/firebaseService';
import { calculateLabFeesForOrder, DEFAULT_PRICES } from '../services/billingService';
import { translateMedicalText, predictPrescription } from '../services/geminiService';
import { numberToWords } from '../services/numberToWords';

interface DoctorDashboardProps {
  doctorName: string;
  patients: Patient[];
  visits: VisitRecord[];
  labOrders: LabOrder[];
  clinicalTemplates: ClinicalTemplate[];
  medicationMaster?: MedicationMasterData;
  pharmacyInventory?: PharmacyItem[]; // Added for Stock Check
  pharmacySales?: PharmacySale[];
  printSettings?: AppPrintSettings;
  billingRates?: ServicePrices;
  ipdAdmissions?: IpdAdmission[];
  consultants?: Consultant[];
  wards?: import('../types').Ward[];
  onUpdateVisits: (v: VisitRecord[]) => void;
  onUpdatePatients: (p: Patient[]) => void;
  onUpdateTemplates: (t: ClinicalTemplate[]) => void;
  onOrderLab: (o: LabOrder) => void;
  onCancelOrder: (id: string) => void;
  onCallPatient: (name: string) => void;
  onAddAdmission?: (admission: IpdAdmission) => void;
}

const USG_INDICATIONS = [
  "i. To diagnose intra-uterine and/or ectopic pregnancy and confirm viability.",
  "ii. Estimation of gestation age (dating).",
  "iii. Detection of number of fetuses and their chorionicity.",
  "iv. Suspected pregnancy with IUCD in situ or suspected pregnancy following contraceptive failure/ MTP failure.",
  "v. Vaginal bleeding/ leaking.",
  "vi. Follow-up of cases of abortion.",
  "vii. Assessment of cervical canal and diameter of internal os.",
  "viii. Discrepancy between uterine size and period of amenorrhea.",
  "ix. Any suspected adenexal or uterine pathology/abnormality.",
  "x. Detection of chromosomal abnormalities, fetal structural defects and other abnormalities and their follow-up.",
  "xi. To evaluate fetal presentation and position.",
  "xii. Assessment of liquor amnii.",
  "xiii. Pre-term labor / pre-term premature rupture of membranes",
  "xiv. Evaluation of placental position, thickness, grading and abnormalities (placenta praevia, retro placental hemorrhage, abnormal adherence etc.)",
  "xv. Evaluation of umbilical cord- presentation, insertion, nuchal encirclement, number of vessels and presence of true knot.",
  "xvi. Evaluation of previous Caesarean Section scars.",
  "xvii. Evaluation of fetal growth parameters, fetal weight and fetal well being.",
  "xviii. Color flow mapping and duplex Doppler studies.",
  "xix. Ultrasound guided procedures such as medical termination of pregnancy, external cephalic version etc and their follow-up.",
  "xx. Adjunct to diagnostics and therapeutic invasive interventions such as chorionic villus sampling (CVS), amniocenteses, fetal skin biopsy, amnio-infusion, intrauterine infusion, placement of shunts, etc.",
  "xxi. Observation of intra-partum events.",
  "xxii. Medical/surgical conditions complicating pregnancy.",
  "xxiii. Research/scientific studies in recognized institutions"
];

const DoctorDashboard: React.FC<DoctorDashboardProps> = ({ 
  doctorName, patients, visits, labOrders, clinicalTemplates, medicationMaster, pharmacyInventory = [], pharmacySales = [], printSettings, billingRates = DEFAULT_PRICES, ipdAdmissions = [], consultants = [], wards = [], onUpdateVisits, onUpdatePatients, onUpdateTemplates, onOrderLab, onCancelOrder, onCallPatient, onAddAdmission
}) => {
  const [activeTab, setActiveTab] = useState<'stats' | 'queue' | 'edd'>('queue');
  
  // Dashboard Drill-down state
  const [dashboardView, setDashboardView] = useState<'overview' | 'rx_stats' | 'opd_stats' | 'ipd_stats' | 'report_stats'>('overview');
  const [dashSearch, setDashSearch] = useState('');
  const [dashDateStart, setDashDateStart] = useState(new Date().toISOString().slice(0, 10));
  const [dashDateEnd, setDashDateEnd] = useState(new Date().toISOString().slice(0, 10));

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showReportPreview, setShowReportPreview] = useState<LabOrder | null>(null);
  const [prescriptionMode, setPrescriptionMode] = useState<'digital' | 'manual'>('digital');
  
  const [localComplaints, setLocalComplaints] = useState('');
  const [localVisitOH, setLocalVisitOH] = useState('');
  const [localMH, setLocalMH] = useState('');
  const [localLmp, setLocalLmp] = useState('');
  const [localEdd, setLocalEdd] = useState('');
  const [localPog, setLocalPog] = useState('');
  const [localPulse, setLocalPulse] = useState('');
  const [localBp, setLocalBp] = useState('');
  const [localWeight, setLocalWeight] = useState('');
  const [localSpo2, setLocalSpo2] = useState('');
  const [localGenNotes, setLocalGenNotes] = useState('');
  const [localPhysExam, setLocalPhysExam] = useState('');
  const [localRx, setLocalRx] = useState('');
  const [localRemarks, setLocalRemarks] = useState('');
  const [localFollowUpDate, setLocalFollowUpDate] = useState('');

  const [showUsgModal, setShowUsgModal] = useState(false);
  const [selectedUsgIndications, setSelectedUsgIndications] = useState<string[]>([]);
  const [showAncModal, setShowAncModal] = useState(false);
  const [showQuickRxModal, setShowQuickRxModal] = useState(false);
  const [showSubstitutionModal, setShowSubstitutionModal] = useState(false);
  const [substitutionSource, setSubstitutionSource] = useState<{name: string, generic: string} | null>(null);
  
  // Billing Modal State
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [currentBillVisit, setCurrentBillVisit] = useState<VisitRecord | null>(null);
  const [billItems, setBillItems] = useState<{name: string, price: number}[]>([]);
  const [billDiscount, setBillDiscount] = useState(0);

  const [qRxGroup, setQRxGroup] = useState('');
  const [qRxSelectedDrugs, setQRxSelectedDrugs] = useState<string[]>([]);
  const [qRxStaging, setQRxStaging] = useState<{drug: string, dose: string, freq: string, duration: string, advice: string}[]>([]);
  const [showPastVisitsModal, setShowPastVisitsModal] = useState(false);
  const [showBedSelectionForIpd, setShowBedSelectionForIpd] = useState(false);
  
  const [labSelection, setLabSelection] = useState<SelectedTests>({
    cbc: false, serology: false, urine: false, other: false, 
    widal: false, crp: false, hormone: false, semen: false,
    bloodSugar: false, bloodGroup: false,
    hormoneDetails: {
        tsh: false, ft3: false, ft4: false, t3: false, t4: false,
        fsh: false, lh: false, prolactin: false, amh: false, hba1c: false
    }
  });
  const [queueDate, setQueueDate] = useState(new Date().toISOString().slice(0, 10));
  const [isTranslating, setIsTranslating] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [templateConfig, setTemplateConfig] = useState<{ isOpen: boolean, type: ClinicalTemplate['category'] | null }>({ isOpen: false, type: null });

  const doctorVisits = useMemo(() => visits.filter(v => v.assignedDoctor === doctorName), [visits, doctorName]);
  
  const pendingVisits = useMemo(() => doctorVisits.filter(v => !v.isApproved && v.date === queueDate).map(v => ({
    ...v,
    patient: patients.find(p => p.id === v.patientId)
  })).filter(v => v.patient), [doctorVisits, patients, queueDate]);

  // --- STATS CALCULATION ---
  const dashboardStats = useMemo(() => {
      const myVisits = visits.filter(v => v.assignedDoctor === doctorName);
      const patientsChecked = myVisits.filter(v => v.isApproved).length;
      
      const myAdmissions = ipdAdmissions.filter(a => a.primaryDoctor === doctorName);
      const patientsAdmitted = myAdmissions.length;
      
      const patientsOperated = myAdmissions.filter(a => {
          const p = patients.find(pat => pat.id === a.patientId);
          return p?.type === 'surgery';
      }).length;

      const reportsOrdered = labOrders.filter(o => {
          const patientVisits = myVisits.filter(v => v.patientId === o.patientId);
          return patientVisits.length > 0;
      }).length;

      const drugsPrescribedCount = myVisits.filter(v => v.prescription && v.prescription.trim().length > 0).length;

      return { patientsChecked, patientsAdmitted, patientsOperated, reportsOrdered, drugsPrescribedCount };
  }, [visits, doctorName, ipdAdmissions, patients, labOrders]);

  const resetFilters = () => {
      setDashSearch('');
      setDashDateStart(new Date().toISOString().slice(0, 10));
      setDashDateEnd(new Date().toISOString().slice(0, 10));
  };

  const handlePatientClick = (p: Patient, visit?: VisitRecord) => {
      setSelectedPatient(p);
      setShowOrderModal(true);
      if (visit) {
          // Pre-load logic if needed for viewing old visits, 
          // currently showOrderModal effect loads latest or unapproved visit.
          // To view old visit, logic inside useEffect needs to handle passed visit ID.
          // For now, standard case sheet open.
      }
  };

  // Helper to calculate total collections
  const calculateCollections = () => {
      const opdVisits = doctorVisits.filter(v => v.date >= dashDateStart && v.date <= dashDateEnd && v.paymentStatus === 'paid');
      const ipdActive = ipdAdmissions.filter(a => a.primaryDoctor === doctorName && a.admissionDate >= dashDateStart && a.admissionDate <= dashDateEnd);
      
      let opdTotal = 0;
      let labTotal = 0;
      let usgTotal = 0;
      let ipdTotal = 0;

      opdVisits.forEach(v => {
          if (v.finalBill) {
              v.finalBill.items.forEach(item => {
                  if (item.name.toLowerCase().includes('consultation')) opdTotal += item.price;
                  else if (item.name.toLowerCase().includes('ultrasound')) usgTotal += item.price;
                  else labTotal += item.price; // Assume others are lab
              });
          } else {
              opdTotal += v.fees; // Fallback
          }
      });

      ipdActive.forEach(a => {
          ipdTotal += (a.advanceAmount || 0) + (a.totalBill || 0);
      });

      return { opdTotal, labTotal, usgTotal, ipdTotal, total: opdTotal + labTotal + usgTotal + ipdTotal };
  };

  const renderPrescriptionStats = () => {
      // 1. Filter visits by doctor and date
      const relevantVisits = doctorVisits.filter(v => v.isApproved && v.date >= dashDateStart && v.date <= dashDateEnd && v.prescription);
      
      // 2. Parse prescriptions
      const drugStats: Record<string, { count: number, qtyPrescribed: number }> = {};
      
      relevantVisits.forEach(v => {
          if (!v.prescription) return;
          const lines = v.prescription.split('\n');
          lines.forEach(line => {
              if (line.trim().length === 0) return;
              
              // Basic parsing assuming format "[Drug Name] [Dose] -- [Freq] -- [Duration] Days ([Advice])"
              // Fallback to name extraction if format differs
              // Strategy: Split by ' -- '
              const parts = line.split(' -- ');
              const drugNameFull = parts[0].trim();
              
              // Clean drug name (remove dose if attached at end or assume standard formatting)
              // Just use the first part as key for now
              const key = drugNameFull.toLowerCase();
              
              if (!drugStats[key]) drugStats[key] = { count: 0, qtyPrescribed: 0 };
              drugStats[key].count += 1;

              // Estimate Quantity
              if (parts.length >= 3) {
                  const freq = parts[1].trim().toLowerCase();
                  const durationStr = parts[2].trim();
                  const days = parseInt(durationStr) || 0;
                  
                  let perDay = 1;
                  if (freq.includes('bd')) perDay = 2;
                  else if (freq.includes('tds')) perDay = 3;
                  else if (freq.includes('qid')) perDay = 4;
                  else if (freq.includes('sos') || freq.includes('od') || freq.includes('hs')) perDay = 1;
                  
                  drugStats[key].qtyPrescribed += (perDay * days);
              }
          });
      });

      // 3. Match with Pharmacy Sales (Approximation by name)
      // Filter sales by date
      const relevantSales = pharmacySales.filter(s => s.date.startsWith(dashDateStart) || (s.date >= dashDateStart && s.date <= dashDateEnd));
      const purchasedStats: Record<string, number> = {};
      
      relevantSales.forEach(s => {
          s.items.forEach(item => {
              const key = item.name.toLowerCase();
              // Try to fuzzy match with drugStats keys
              const matchedKey = Object.keys(drugStats).find(k => k.includes(key) || key.includes(k));
              if (matchedKey) {
                  purchasedStats[matchedKey] = (purchasedStats[matchedKey] || 0) + item.qty;
              } else {
                  // Track unprescribed purchases or mismatch
                  purchasedStats[key] = (purchasedStats[key] || 0) + item.qty;
              }
          });
      });

      // Combine
      const rows = Object.keys(drugStats).map(key => ({
          name: key,
          count: drugStats[key].count,
          qtyPrescribed: drugStats[key].qtyPrescribed,
          qtyPurchased: purchasedStats[key] || 0
      })).filter(r => r.name.toLowerCase().includes(dashSearch.toLowerCase()));

      return (
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                      <tr><th className="p-4">Drug Name</th><th className="p-4 text-center">Times Prescribed</th><th className="p-4 text-center">Est. Qty Prescribed</th><th className="p-4 text-center">Qty Purchased (Pharmacy)</th></tr>
                  </thead>
                  <tbody className="divide-y">
                      {rows.map((r, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                              <td className="p-4 font-bold capitalize">{r.name}</td>
                              <td className="p-4 text-center">{r.count}</td>
                              <td className="p-4 text-center">{r.qtyPrescribed > 0 ? r.qtyPrescribed : '-'}</td>
                              <td className="p-4 text-center font-black text-blue-600">{r.qtyPurchased}</td>
                          </tr>
                      ))}
                      {rows.length === 0 && <tr><td colSpan={4} className="p-8 text-center italic text-slate-400">No prescriptions found.</td></tr>}
                  </tbody>
              </table>
          </div>
      );
  };

  const renderPatientStats = (type: 'opd' | 'ipd') => {
      if (type === 'opd') {
          const list = doctorVisits
              .filter(v => v.isApproved && v.date >= dashDateStart && v.date <= dashDateEnd)
              .map(v => ({ visit: v, patient: patients.find(p => p.id === v.patientId) }))
              .filter(x => x.patient && x.patient.name.toLowerCase().includes(dashSearch.toLowerCase()));

          return (
              <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                          <tr><th className="p-4">Date</th><th className="p-4">Patient Name</th><th className="p-4">Type</th><th className="p-4 text-right">Bill Amount</th><th className="p-4 text-center">Status</th></tr>
                      </thead>
                      <tbody className="divide-y">
                          {list.map(({visit, patient}, i) => (
                              <tr key={i} onClick={() => handlePatientClick(patient!, visit)} className="hover:bg-blue-50 cursor-pointer transition-colors">
                                  <td className="p-4 text-xs font-bold text-slate-500">{visit.date}</td>
                                  <td className="p-4 font-black text-slate-800">{patient!.name} <span className="text-xs font-normal text-slate-400">({patient!.age})</span></td>
                                  <td className="p-4 text-xs uppercase font-bold">{visit.visitType}</td>
                                  <td className="p-4 text-right font-mono">₹{visit.finalBill?.grandTotal || visit.fees}</td>
                                  <td className="p-4 text-center">
                                      <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${visit.paymentStatus === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{visit.paymentStatus || 'Pending'}</span>
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          );
      } else {
          const list = ipdAdmissions
              .filter(a => a.primaryDoctor === doctorName && a.admissionDate >= dashDateStart && a.admissionDate <= dashDateEnd)
              .map(a => ({ admission: a, patient: patients.find(p => p.id === a.patientId) }))
              .filter(x => x.patient && x.patient.name.toLowerCase().includes(dashSearch.toLowerCase()));

          return (
              <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                          <tr><th className="p-4">Admit Date</th><th className="p-4">Patient Name</th><th className="p-4">Diagnosis</th><th className="p-4 text-right">Bill/Advance</th><th className="p-4 text-center">Status</th></tr>
                      </thead>
                      <tbody className="divide-y">
                          {list.map(({admission, patient}, i) => (
                              <tr key={i} className="hover:bg-purple-50 cursor-pointer transition-colors">
                                  <td className="p-4 text-xs font-bold text-slate-500">{new Date(admission.admissionDate).toLocaleDateString()}</td>
                                  <td className="p-4 font-black text-slate-800">{patient!.name}</td>
                                  <td className="p-4 text-xs font-bold">{admission.diagnosis}</td>
                                  <td className="p-4 text-right font-mono">₹{(admission.totalBill || admission.advanceAmount || 0)}</td>
                                  <td className="p-4 text-center">
                                      <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${admission.status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>{admission.status}</span>
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          );
      }
  };

  const renderReportStats = () => {
      const list = labOrders
          .filter(o => {
              // Check if order belongs to a patient seen by this doctor
              // Simple check: Is the patient currently in the doctor's visit list?
              // Better: Check if the order was created during a visit with this doctor. 
              // We'll approximate by checking if the patient has EVER seen this doctor.
              const patientSeen = doctorVisits.some(v => v.patientId === o.patientId);
              const orderDate = new Date(o.timestamp).toISOString().slice(0, 10);
              return patientSeen && orderDate >= dashDateStart && orderDate <= dashDateEnd;
          })
          .map(o => ({ order: o, patient: patients.find(p => p.id === o.patientId) }))
          .filter(x => x.patient && x.patient.name.toLowerCase().includes(dashSearch.toLowerCase()));

      return (
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                      <tr><th className="p-4">Date</th><th className="p-4">Patient Name</th><th className="p-4">Tests</th><th className="p-4 text-right">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y">
                      {list.map(({order, patient}, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                              <td className="p-4 text-xs font-bold text-slate-500">{new Date(order.timestamp).toLocaleDateString()}</td>
                              <td className="p-4 font-black text-slate-800">{patient!.name}</td>
                              <td className="p-4 text-xs font-bold text-slate-600">
                                  {Object.keys(order.tests).filter(k => k!=='hormoneDetails' && (order.tests as any)[k]).join(', ')}
                                  {order.ultrasound && ' USG'}
                              </td>
                              <td className="p-4 text-right space-x-2">
                                  {order.status === 'completed' ? (
                                      <>
                                          <button onClick={() => setShowReportPreview(order)} className="text-blue-600 font-black text-xs hover:underline">View</button>
                                          <button onClick={() => { setShowReportPreview(order); setTimeout(() => window.print(), 500); }} className="text-purple-600 font-black text-xs hover:underline">Print</button>
                                      </>
                                  ) : (
                                      <span className="text-amber-500 text-[10px] font-bold uppercase">Pending</span>
                                  )}
                              </td>
                          </tr>
                      ))}
                  </tbody>
              </table>
          </div>
      );
  };

  useEffect(() => {
    if (showOrderModal && selectedPatient) {
      const activeVisit = visits.find(v => v.patientId === selectedPatient.id && !v.isApproved) 
                        || visits.find(v => v.patientId === selectedPatient.id && v.isApproved);
      
      setLocalComplaints(activeVisit?.complaints || '');
      setLocalVisitOH(activeVisit?.visitObstetricHistory || selectedPatient.obstetricHistory || '');
      setLocalMH(activeVisit?.menstrualHistory || '');
      setLocalLmp(activeVisit?.visitLmp || selectedPatient.pregnancyInfo?.lmp || '');
      setLocalEdd(activeVisit?.visitEdd || selectedPatient.pregnancyInfo?.edd || '');
      setLocalPog(activeVisit?.visitPog || selectedPatient.pregnancyInfo?.pog || '');
      setLocalPulse(activeVisit?.vitals?.pulse || '');
      setLocalBp(activeVisit?.vitals?.bp || '');
      setLocalWeight(activeVisit?.vitals?.weight || '');
      setLocalSpo2(activeVisit?.vitals?.spo2 || '');
      setLocalGenNotes(activeVisit?.generalExamination || '');
      setLocalPhysExam(activeVisit?.examinationDetails || '');
      setLocalRx(activeVisit?.prescription || '');
      setLocalRemarks(activeVisit?.remarks || '');
      setLocalFollowUpDate(activeVisit?.followUpDate || '');
      
      setLabSelection({
        cbc: false, serology: false, urine: false, other: false, 
        widal: false, crp: false, hormone: false, semen: false,
        bloodSugar: false, bloodGroup: false,
        hormoneDetails: {
            tsh: false, ft3: false, ft4: false, t3: false, t4: false,
            fsh: false, lh: false, prolactin: false, amh: false, hba1c: false
        }
      });
    }
  }, [showOrderModal, selectedPatient, visits]);

  // Helper to check stock status - returns available quantity
  const getStockLevel = (drugName: string) => {
      const item = pharmacyInventory.find(i => i.name.toLowerCase() === drugName.toLowerCase());
      return item ? item.quantity : 0;
  };

  const getAlternatives = (drugName: string) => {
      const original = pharmacyInventory.find(i => i.name.toLowerCase() === drugName.toLowerCase());
      if(!original || !original.genericName) return [];
      
      // Find other items with matching generic name that have stock
      return pharmacyInventory.filter(i => 
          i.genericName?.toLowerCase() === original.genericName?.toLowerCase() && 
          i.id !== original.id &&
          i.quantity > 0
      );
  };

  const handleDrugClick = (drugName: string) => {
      const stock = getStockLevel(drugName);
      
      if (stock > 0) {
          // Normal Toggle behavior
          toggleQRxDrug(drugName);
      } else {
          // Out of Stock Logic
          const originalItem = pharmacyInventory.find(i => i.name.toLowerCase() === drugName.toLowerCase());
          setSubstitutionSource({ name: drugName, generic: originalItem?.genericName || '' });
          setShowSubstitutionModal(true);
      }
  };

  const handleSubstitute = (replacementName: string) => {
      toggleQRxDrug(replacementName);
      setShowSubstitutionModal(false);
      setSubstitutionSource(null);
  };

  const handleForceAdd = () => {
      if (substitutionSource) {
          toggleQRxDrug(substitutionSource.name);
          setShowSubstitutionModal(false);
          setSubstitutionSource(null);
      }
  };

    const handleAiAssist = async () => {
    if (!selectedPatient) return;
    setIsAiLoading(true);
    try {
        // Build historic context from this doctor's previous visits
        const pastVisits = visits.filter(v => v.assignedDoctor === doctorName && v.isApproved && v.patientId).slice(-20); // last 20 visits
        let pastRecordsContext = "";
        pastVisits.forEach((v, index) => {
            const p = patients.find(pat => pat.id === v.patientId);
            // v.physicalExamination doesn't exist, it's v.examinationDetails
            // v.diagnosis doesn't exist on VisitRecord, removed.
            pastRecordsContext += `Visit ${index + 1} (${p?.type || 'general'}):\n- Complaints: ${v.complaints}\n- Exam/Vitals: ${v.examinationDetails}\n- Rx: ${v.prescription}\n\n`;
        });

        const currentGestationalAge = localPog ? localPog + " weeks" : (localLmp ? `LMP: ${localLmp}` : "N/A");
        const extraPhysExamContext = selectedPatient.type === 'obstetric' ? `\nGestational Age: ${currentGestationalAge}\n` + localPhysExam : localPhysExam;

        const prediction = await predictPrescription(
            localComplaints,
            localRx,
            extraPhysExamContext,
            pastRecordsContext,
            selectedPatient.type as "general" | "obstetric" | "pediatric"
        );

        setLocalComplaints(prediction.complaints);
        setLocalRx(prediction.rx);
        if (selectedPatient.type !== 'obstetric') {
            setLocalPhysExam(prediction.physExam); // For obstetric we have complex vitals, but we can set anyway if AI adds something. Let's merge or replace gently.
        } else {
             // For obstetric, the vitals form is structured, but we still have a plain text box for extra notes. 
             // We can just append to localPhysExam if it predicted something new.
             if (prediction.physExam !== extraPhysExamContext) {
                 setLocalPhysExam(prediction.physExam);
             }
        }
    } catch (err: any) {
        console.error("AI Assist Failed", err);
        if (err.message?.includes('503') || err.message?.includes('high demand') || err.status === 'UNAVAILABLE') {
            alert("The AI model is currently experiencing high demand. Please try again in a few moments.");
        } else {
            alert("Failed to get AI predictions. Please try again.");
        }
    } finally {
        setIsAiLoading(false);
    }
  };

  // ... (Previous Helper Functions: handleSaveCaseData, handleApprove, Billing, Print, Calculations) ...
  const handleSaveCaseData = (silent = false) => {
    if (!selectedPatient) return;
    const pregInfo: PregnancyInfo | undefined = localLmp ? { lmp: localLmp, edd: localEdd, pog: localPog } : selectedPatient.pregnancyInfo;
    const updatedPatients = patients.map(p => p.id === selectedPatient.id ? { ...p, obstetricHistory: localVisitOH, pregnancyInfo: pregInfo } : p);
    onUpdatePatients(updatedPatients);

    const activeVisit = visits.find(v => v.patientId === selectedPatient.id && !v.isApproved)
                      || visits.find(v => v.patientId === selectedPatient.id && v.isApproved);
    
    if (activeVisit) {
      const updatedVisits = visits.map(v => v.id === activeVisit.id ? { 
        ...v, 
        complaints: localComplaints,
        visitObstetricHistory: localVisitOH,
        menstrualHistory: localMH,
        visitLmp: localLmp,
        visitEdd: localEdd,
        visitPog: localPog,
        vitals: { ...v.vitals, pulse: localPulse, bp: localBp, weight: localWeight, spo2: localSpo2 } as Vitals,
        generalExamination: localGenNotes,
        examinationDetails: localPhysExam, 
        prescription: localRx,
        remarks: localRemarks,
        followUpDate: localFollowUpDate
      } : v);
      onUpdateVisits(updatedVisits);
    }
    if(!silent) alert("Case record saved.");
  };

  const handleApprove = (visitId: string) => {
    if (!selectedPatient) return;
    handleSaveCaseData(true);
    const updatedVisits = visits.map(v => v.id === visitId ? { ...v, isApproved: true, callingStatus: 'waiting' } as VisitRecord : v);
    onUpdateVisits(updatedVisits);
    setShowOrderModal(false);
  };

  const handleOpenBilling = () => {
      const activeVisit = visits.find(v => v.patientId === selectedPatient?.id && (!v.isApproved || v.date === queueDate));
      if (!activeVisit) {
          alert("No active visit found for billing.");
          return;
      }

      setCurrentBillVisit(activeVisit);
      
      const items = [{ name: `Consultation (${activeVisit.visitType})`, price: activeVisit.fees }];
      const orders = labOrders.filter(o => o.patientId === activeVisit.patientId); 
      
      orders.forEach(o => {
          if (o.ultrasound) items.push({ name: 'Ultrasound', price: billingRates.ultrasound?.price || 800 });
          if (o.tests) {
              Object.entries(o.tests).forEach(([k, v]) => {
                  if (k === 'hormone' && o.tests.hormoneDetails) {
                      Object.entries(o.tests.hormoneDetails).forEach(([hKey, hSelected]) => {
                          if (hSelected && billingRates[hKey]) {
                              items.push({ name: billingRates[hKey].name, price: billingRates[hKey].price });
                          }
                      });
                  } else if (v && billingRates[k]) {
                      items.push({ name: billingRates[k].name, price: billingRates[k].price });
                  }
              });
          }
      });

      setBillItems(items);
      setBillDiscount(0);
      setShowBillingModal(true);
  };

  const handleFinalizeBill = (method: 'cash' | 'upi') => {
      if (!currentBillVisit) return;
      const subTotal = billItems.reduce((acc, item) => acc + item.price, 0);
      const grandTotal = subTotal - billDiscount;
      const billNo = `B-${Date.now().toString().slice(-6)}`;
      const finalBill = {
          billNumber: billNo, items: billItems, subTotal, discount: billDiscount, grandTotal,
          collectedBy: doctorName, paymentMethod: method, date: new Date().toISOString()
      };
      const updated = visits.map(v => v.id === currentBillVisit.id ? { 
          ...v, paymentStatus: 'paid', paymentMethod: method, collectedBy: doctorName, finalBill: finalBill
      } as VisitRecord : v);
      onUpdateVisits(updated);
      setShowBillingModal(false);
      setCurrentBillVisit(null);
      alert(`Payment of ₹${grandTotal} Collected! Bill #${billNo}`);
  };

  const handlePrintBill = (visit: VisitRecord) => {
    const patient = patients.find(p => p.id === visit.patientId);
    if (!patient) return;
    const billItemsToPrint = visit.finalBill?.items || [{ name: 'Consultation', price: visit.fees }];
    const total = visit.finalBill?.grandTotal || visit.fees;
    const billNo = visit.finalBill?.billNumber || 'DRAFT';
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const rows = billItemsToPrint.map(item => `<tr><td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.name}</td><td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">₹${item.price.toFixed(2)}</td></tr>`).join('');
    const layout = printSettings?.bill || { marginTop: 10, marginBottom: 10, marginLeft: 10, marginRight: 10, headerHeight: 70, footerHeight: 10 };
    printWindow.document.write(`<html><head><title>Hospital Bill</title><style>body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; margin: 0; padding-top: ${layout.marginTop}mm; padding-bottom: ${layout.marginBottom}mm; padding-left: ${layout.marginLeft}mm; padding-right: ${layout.marginRight}mm;} .header-space { height: ${layout.headerHeight}mm; } .container { width: 100%; } .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; } .header h1 { margin: 0; font-size: 24px; text-transform: uppercase; } .header p { margin: 5px 0 0; font-size: 14px; } .info { display: flex; justify-content: space-between; margin-bottom: 20px; } .info div { line-height: 1.6; font-size: 14px; } table { width: 100%; border-collapse: collapse; margin-bottom: 20px; } th { text-align: left; padding: 10px; border-bottom: 2px solid #333; font-size: 12px; text-transform: uppercase; } .total-row td { border-top: 2px solid #333; font-weight: bold; font-size: 16px; color: #000; padding: 10px; } .words { font-style: italic; font-size: 13px; margin-bottom: 40px; } .signatures { display: flex; justify-content: space-between; margin-top: 50px; font-size: 12px; font-weight: bold; } .signatures div { border-top: 1px solid #333; padding-top: 5px; width: 40%; text-align: center; } @media print { body { padding: 0; padding-top: ${layout.marginTop}mm; padding-left: ${layout.marginLeft}mm; } @page { margin: 0; } }</style></head><body><div class="header-space"></div><div class="container"><div class="header"><h1>J J HOSPITAL DONDAICHA</h1><p>Consultant: ${visit.assignedDoctor}</p></div><div class="info"><div><strong>Patient Details:</strong><br>Name: ${patient.name}<br>UHID: ${patient.uhid || 'N/A'}<br>Age: ${patient.age || '-'}</div><div style="text-align: right;"><strong>Bill Details:</strong><br>Bill No: ${billNo}<br>Date: ${visit.date}<br>Time: ${new Date().toLocaleTimeString()}</div></div><table><thead><tr><th>Description</th><th style="text-align: right;">Amount</th></tr></thead><tbody>${rows}</tbody><tfoot><tr class="total-row"><td>Grand Total</td><td style="text-align: right;">₹${total.toFixed(2)}</td></tr></tfoot></table><div class="words">Amount in Words: Rupees ${numberToWords(Math.floor(total))} Only</div><div class="signatures"><div>Patient Signature</div><div>Authorized Signatory</div></div></div><script>window.onload = () => { window.print(); window.close(); }</script></body></html>`);
    printWindow.document.close();
  };

  const calculateEdd = (lmpDateStr: string) => {
    if (!lmpDateStr) return;
    const lmp = new Date(lmpDateStr);
    const edd = new Date(lmp);
    edd.setDate(edd.getDate() + 280);
    setLocalEdd(edd.toISOString().split('T')[0]);
    const today = new Date();
    const diff = today.getTime() - lmp.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const weeks = Math.floor(days / 7);
    const remDays = days % 7;
    setLocalPog(`${weeks}w ${remDays}d`);
  };

  const handlePrintPrescription = () => {
    if (!selectedPatient) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const mhParts = [];
    if (localLmp) mhParts.push(`LMP: ${localLmp}`);
    if (localEdd) mhParts.push(`EDD: ${localEdd}`);
    if (localPog) mhParts.push(`POG: ${localPog}`);
    const mhText = (localMH ? localMH + ' ' : '') + (mhParts.length > 0 ? `(${mhParts.join(' | ')})` : '');
    const genExamParts = [];
    if (localPulse) genExamParts.push(`Puls: ${localPulse}`);
    if (localBp) genExamParts.push(`BP: ${localBp}`);
    if (localWeight) genExamParts.push(`Wt: ${localWeight}kg`);
    if (localSpo2) genExamParts.push(`SpO2: ${localSpo2}%`);
    const genExamText = (localGenNotes ? localGenNotes + ' ' : '') + (genExamParts.length > 0 ? `[${genExamParts.join(', ')}]` : '');
    
    // Dynamic doctor lookup
    const docObj = consultants.find(c => c.name === doctorName);
    const selectedDoctor = { qualifications: docObj?.qualifications || '', specialty: docObj?.specialty || '' };

    const contentHtml = `
      <div class="line-item flex gap-6 border-b pb-2 mb-6">${selectedPatient.name ? `<span><strong>Name:</strong> ${selectedPatient.name}</span>` : ''}${selectedPatient.age ? `<span><strong>Age:</strong> ${selectedPatient.age}</span>` : ''}${selectedPatient.address ? `<span class="flex-grow text-right"><strong>Address:</strong> ${selectedPatient.address}</span>` : ''}</div>
      ${localComplaints.trim() ? `<div class="paragraph-item"><div class="font-bold mb-1">Complaints:</div><div class="whitespace-pre-wrap pl-2 leading-relaxed text-slate-800">${localComplaints}</div></div>` : ''}
      ${localVisitOH.trim() ? `<div class="line-item"><span class="font-bold">Obstetric History:</span><span class="text-slate-800 ml-1">${localVisitOH}</span></div>` : ''}
      ${mhText.trim() ? `<div class="line-item"><span class="font-bold">Menstrual History:</span><span class="text-slate-800 ml-1">${mhText}</span></div>` : ''}
      ${genExamText.trim() ? `<div class="line-item"><span class="font-bold">General Examination:</span><span class="text-slate-800 ml-1">${genExamText}</span></div>` : ''}
      ${localPhysExam.trim() ? `<div class="paragraph-item mt-6"><div class="font-bold mb-1">Physical Examination:</div><div class="whitespace-pre-wrap pl-2 leading-relaxed text-slate-800">${localPhysExam}</div></div>` : ''}
      ${localRx.trim() ? `<div class="mt-10 border-t pt-6"><div class="text-3xl font-black text-slate-900 mb-4">Rx</div><div class="whitespace-pre-wrap text-[18px] font-bold leading-loose pl-2 text-slate-900">${localRx}</div></div>` : ''}
      ${(localRemarks.trim() || localFollowUpDate) ? `<div class="mt-6 border-t pt-4">${localRemarks.trim() ? `<div class="mb-2"><span class="font-bold">Remarks:</span> <span class="text-slate-800">${localRemarks}</span></div>` : ''}${localFollowUpDate ? `<div><span class="font-bold">Follow-up Date:</span> <span class="text-slate-800 font-bold">${new Date(localFollowUpDate).toLocaleDateString('en-IN')}</span></div>` : ''}</div>` : ''}
    `;
    const layout = printSettings?.prescription || { marginTop: 60, marginBottom: 20, marginLeft: 20, marginRight: 20, headerHeight: 0, footerHeight: 20 };
    printWindow.document.write(`<html><head><title>Prescription - ${selectedPatient.name}</title><script src="https://cdn.tailwindcss.com"></script><style>@page { size: A4; margin: 0; } body { font-family: 'Inter', system-ui, -apple-system, sans-serif; padding-top: ${layout.marginTop}mm; padding-bottom: ${layout.marginBottom}mm; padding-left: ${layout.marginLeft}mm; padding-right: ${layout.marginRight}mm; background: white; color: black; min-height: 297mm; position: relative; box-sizing: border-box; } .line-item { margin-bottom: 8px; font-size: 14px; } .paragraph-item { margin-bottom: 16px; font-size: 14px; } .footer { position: absolute; bottom: ${layout.marginBottom}mm; right: ${layout.marginRight}mm; text-align: right; } </style></head><body><div style="height: ${layout.headerHeight}mm"></div><div class="max-w-[190mm] mx-auto">${contentHtml}</div><div class="footer"><div class="h-16 w-52 border-b border-slate-300 mb-2 ml-auto"></div><p class="font-black uppercase text-sm">${doctorName}</p><p class="text-[11px] font-bold text-slate-500 uppercase tracking-tight">${selectedDoctor.qualifications}</p><p class="text-[11px] font-bold text-slate-500 uppercase tracking-tight">${selectedDoctor.specialty}</p></div><script>window.onload = () => { window.print(); window.close(); }</script></body></html>`);
    printWindow.document.close();
  };

  const handlePrintUsgReferral = () => {
    if (!selectedPatient) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const mhParts = [];
    if (localLmp) mhParts.push(`LMP: ${localLmp}`);
    if (localEdd) mhParts.push(`EDD: ${localEdd}`);
    if (localPog) mhParts.push(`POG: ${localPog}`);
    const mhText = (localMH ? localMH + ' ' : '') + (mhParts.length > 0 ? `(${mhParts.join(' | ')})` : '');
    const indicationsHtml = selectedUsgIndications.map(ind => `<li class="mb-2">${ind}</li>`).join('');
    printWindow.document.write(`<html><head><title>USG OBS Referral - ${selectedPatient.name}</title><script src="https://cdn.tailwindcss.com"></script><style>@page { size: A4; margin: 0; } body { font-family: 'Inter', sans-serif; padding: 40px; padding-top: 60mm; background: white; color: black; }</style></head><body class="text-slate-900"><div class="border-b-2 border-slate-900 pb-4 mb-8"><h1 class="text-2xl font-black uppercase tracking-tighter">USG OBS Referral Slip</h1><p class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Obstetrics & Gynecology Department</p></div><div class="space-y-6"><div class="grid grid-cols-2 gap-8 bg-slate-50 p-6 rounded-2xl border border-slate-200"><div class="space-y-2"><p class="text-[10px] font-black text-slate-400 uppercase">Referred By Doctor</p><p class="font-black text-blue-700 text-lg">${doctorName}</p></div><div class="text-right"><p class="text-[10px] font-black text-slate-400 uppercase">Date</p><p class="font-bold text-slate-900">${new Date().toLocaleDateString('en-IN')}</p></div></div><div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm border-b pb-6"><div class="space-y-1"><p class="text-[10px] font-black text-slate-400 uppercase">Name of Patient</p><p class="font-bold text-lg">${selectedPatient.name}</p></div><div class="space-y-1"><p class="text-[10px] font-black text-slate-400 uppercase">Age</p><p class="font-bold">${selectedPatient.age}</p></div><div class="space-y-1"><p class="text-[10px] font-black text-slate-400 uppercase">Address</p><p class="font-bold">${selectedPatient.address || 'Not Provided'}</p></div><div class="space-y-1"><p class="text-[10px] font-black text-slate-400 uppercase">Mobile Number</p><p class="font-bold">${selectedPatient.mobile}</p></div></div><div class="grid grid-cols-1 md:grid-cols-2 gap-6"><div class="bg-slate-50 p-4 rounded-xl border border-slate-200"><h3 class="text-[10px] font-black text-slate-400 uppercase mb-2">Menstrual History</h3><p class="text-sm font-medium whitespace-pre-wrap">${mhText || 'N/A'}</p></div><div class="bg-slate-50 p-4 rounded-xl border border-slate-200"><h3 class="text-[10px] font-black text-slate-400 uppercase mb-2">Obstetric History</h3><p class="text-sm font-medium whitespace-pre-wrap">${localVisitOH || 'N/A'}</p></div></div><div class="mt-8"><h3 class="text-[11px] font-black text-slate-900 uppercase border-l-4 border-blue-600 pl-3 mb-4 tracking-widest">Indication for Sonography (OBS)</h3><ul class="list-disc pl-8 text-sm font-medium text-slate-800 leading-relaxed">${indicationsHtml || '<li>Routine obstetric examination</li>'}</ul></div></div><div class="mt-24 border-t-2 border-slate-100 pt-10 flex justify-between items-end"><div class="text-[9px] font-bold text-slate-400 uppercase italic">* Referral generated for Diagnostic Ultrasound.<br>* Please carry all previous reports.</div><div class="text-center"><div class="h-14 w-40 border-b border-slate-300 mb-2"></div><p class="font-black uppercase text-xs text-slate-900">${doctorName}</p><p class="text-[9px] font-bold text-slate-400 uppercase">Consultant Signature</p></div></div><script>window.onload = () => { window.print(); window.close(); }</script></body></html>`);
    printWindow.document.close();
    setShowUsgModal(false);
    setSelectedUsgIndications([]);
  };

  // ... (Rest of component remains unchanged)
  const handleToggleIndication = (ind: string) => {
    setSelectedUsgIndications(prev => 
      prev.includes(ind) ? prev.filter(i => i !== ind) : [...prev, ind]
    );
  };

  const handleSaveTemplate = (category: ClinicalTemplate['category'], content: string) => {
    if (!content.trim()) return;
    const title = prompt("Enter a title for this template:", "New Template");
    if (!title) return;
    onUpdateTemplates([...clinicalTemplates, { id: Date.now().toString(), title, content, category }]);
    alert("Template saved!");
  };

  const useTemplate = (t: ClinicalTemplate) => {
    const setters: Record<string, Function> = {
      complaints: setLocalComplaints,
      oh: setLocalVisitOH,
      mh: setLocalMH,
      gen_exam: setLocalGenNotes,
      phys_exam: setLocalPhysExam,
      prescription: setLocalRx
    };
    const setter = setters[t.category];
    if (setter) setter((prev: string) => prev ? prev + '\n' + t.content : t.content);
    setTemplateConfig({ isOpen: false, type: null });
  };

  const toggleLabTest = (key: keyof SelectedTests) => {
    setLabSelection(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleHormoneDetail = (key: keyof HormoneReportSelection) => {
      setLabSelection(prev => ({ ...prev, hormone: true, hormoneDetails: { ...prev.hormoneDetails, [key]: !prev.hormoneDetails?.[key] } }));
  };

  const handlePlaceLabOrder = () => {
    if (!selectedPatient) return;
    const hasHormone = labSelection.hormone || (labSelection.hormoneDetails && Object.values(labSelection.hormoneDetails).some(v => v));
    const finalTests = { ...labSelection, hormone: hasHormone };
    if (!Object.values(finalTests).some(v => v === true || (typeof v === 'object' && v !== null))) {
        alert("Please select at least one test to order.");
        return;
    }
    const newOrder: LabOrder = {
      id: `o-${Date.now()}`, patientId: selectedPatient.id, tests: { ...finalTests, other: finalTests.other || finalTests.bloodSugar || finalTests.bloodGroup } as SelectedTests, ultrasound: false, status: 'pending', timestamp: Date.now()
    };
    onOrderLab(newOrder);
    alert("Lab Order Placed Successfully!");
    setLabSelection({
        cbc: false, serology: false, urine: false, other: false, widal: false, crp: false, hormone: false, semen: false, bloodSugar: false, bloodGroup: false, hormoneDetails: { tsh: false, ft3: false, ft4: false, t3: false, t4: false, fsh: false, lh: false, prolactin: false, amh: false, hba1c: false }
    });
  };

  const prefillANCProfile = () => {
    setLabSelection(prev => ({ ...prev, cbc: true, serology: true, urine: true, bloodSugar: true, bloodGroup: true, hormone: true, hormoneDetails: { ...prev.hormoneDetails, tsh: true } }));
  };

  const handleOrderUSG = () => {
    if (!selectedPatient) return;
    onOrderLab({ id: `usg-${Date.now()}`, patientId: selectedPatient.id, status: 'completed', timestamp: Date.now(), tests: {} as any, ultrasound: true });
    if (selectedPatient.type === 'obstetric') { setShowUsgModal(true); } else { alert("USG Order Placed (Non-Obstetric)."); }
  };

  const handleAddToStaging = () => {
      if (qRxSelectedDrugs.length === 0) return;
      
      const newEntries = qRxSelectedDrugs.map(drugName => {
          // Find drug details from master to prepopulate defaults
          const drugDetails = medicationMaster?.drugs.find(d => d.name === drugName);
          return {
              drug: drugName,
              dose: drugDetails?.defaultDose || '',
              freq: drugDetails?.defaultFrequency || '',
              duration: drugDetails?.defaultDuration || '',
              advice: drugDetails?.defaultAdvice || ''
          };
      });
      
      setQRxStaging(prev => [...prev, ...newEntries]);
      setQRxSelectedDrugs([]); 
  };

  const updateStagingItem = (index: number, field: 'freq' | 'advice' | 'duration' | 'dose', value: string) => {
      setQRxStaging(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const handleQuickRxConfirm = () => {
      const formattedRx = qRxStaging.map(item => {
          // Format: [Drug Name] [Dose] -- [Freq] -- [Duration] Days ([Advice])
          let line = item.drug;
          if (item.dose) line += ` ${item.dose}`;
          if (item.freq) line += ` -- ${item.freq}`;
          if (item.duration) line += ` -- ${item.duration} Days`;
          if (item.advice) line += ` (${item.advice})`;
          return line;
      }).join('\n');
      setLocalRx(prev => prev ? prev + '\n' + formattedRx : formattedRx);
      setQRxStaging([]); setQRxGroup(''); setQRxSelectedDrugs([]); setShowQuickRxModal(false);
  };

  const toggleQRxDrug = (drugName: string) => {
      setQRxSelectedDrugs(prev => prev.includes(drugName) ? prev.filter(d => d !== drugName) : [...prev, drugName]);
  };

  const handleTranslateRx = async (lang: 'Marathi' | 'Hindi') => {
      if (!localRx.trim()) return;
      setIsTranslating(true);
      try {
          const translated = await translateMedicalText(localRx, lang);
          setLocalRx(prev => prev + '\n\n' + translated);
      } catch (error) { alert('Translation failed. Please try again.'); } finally { setIsTranslating(false); }
  };

  const eddGroups = useMemo(() => {
      const groups: Record<string, Patient[]> = {};
      const seenMap = new Set<string>();
      patients.forEach(p => {
          if(p.type === 'obstetric' && p.pregnancyInfo?.edd) {
              const uniqueKey = `${p.name.trim().toLowerCase()}|${p.pregnancyInfo.edd}`;
              if (!seenMap.has(uniqueKey)) {
                  seenMap.add(uniqueKey);
                  const date = new Date(p.pregnancyInfo.edd);
                  const key = date.toLocaleString('default', { month: 'long', year: 'numeric' });
                  if(!groups[key]) groups[key] = [];
                  groups[key].push(p);
              }
          }
      });
      const sortedKeys = Object.keys(groups).sort((a,b) => new Date(a).getTime() - new Date(b).getTime());
      return sortedKeys.map(key => ({ month: key, patients: groups[key].sort((a,b) => new Date(a.pregnancyInfo!.edd).getTime() - new Date(b.pregnancyInfo!.edd).getTime()) }));
  }, [patients]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        {/* Tabs */}
        <div className="flex space-x-2 bg-slate-200 p-1 rounded-2xl w-fit">
            <button onClick={() => setActiveTab('stats')} className={`px-8 py-3 rounded-xl font-black transition-all whitespace-nowrap uppercase tracking-widest text-[10px] ${activeTab === 'stats' ? 'bg-white text-purple-600 shadow-xl' : 'text-slate-600 hover:text-slate-800'}`}>My Dashboard</button>
            <button onClick={() => setActiveTab('queue')} className={`px-8 py-3 rounded-xl font-black transition-all whitespace-nowrap uppercase tracking-widest text-[10px] ${activeTab === 'queue' ? 'bg-white text-blue-600 shadow-xl' : 'text-slate-600 hover:text-slate-800'}`}>Queue</button>
            <button onClick={() => setActiveTab('edd')} className={`px-8 py-3 rounded-xl font-black transition-all whitespace-nowrap uppercase tracking-widest text-[10px] ${activeTab === 'edd' ? 'bg-white text-pink-600 shadow-xl' : 'text-slate-600 hover:text-slate-800'}`}>EDD</button>
        </div>

        {/* Prescription Toggle */}
        <div className="flex bg-slate-200 p-1 rounded-2xl border border-slate-300">
            <button onClick={() => setPrescriptionMode('digital')} className={`px-6 py-3 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all ${prescriptionMode === 'digital' ? 'bg-white shadow text-blue-600' : 'text-slate-500'}`}>Digital Rx</button>
            <button onClick={() => setPrescriptionMode('manual')} className={`px-6 py-3 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all ${prescriptionMode === 'manual' ? 'bg-white shadow text-purple-600' : 'text-slate-500'}`}>Manual Rx</button>
        </div>
      </div>

      {activeTab === 'stats' && (
          <div className="space-y-6 animate-in fade-in duration-500">
              
              {dashboardView === 'overview' && (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
                        <div onClick={() => { setDashboardView('opd_stats'); resetFilters(); }} className="bg-blue-600 p-6 rounded-2xl shadow-xl text-white transform hover:scale-105 transition-all cursor-pointer">
                            <p className="text-xs font-black uppercase opacity-80 tracking-widest">Patients Checked</p>
                            <p className="text-4xl font-black mt-2">{dashboardStats.patientsChecked}</p>
                        </div>
                        <div onClick={() => { setDashboardView('ipd_stats'); resetFilters(); }} className="bg-purple-600 p-6 rounded-2xl shadow-xl text-white transform hover:scale-105 transition-all cursor-pointer">
                            <p className="text-xs font-black uppercase opacity-80 tracking-widest">Patients Admitted</p>
                            <p className="text-4xl font-black mt-2">{dashboardStats.patientsAdmitted}</p>
                        </div>
                        <div onClick={() => { setDashboardView('ipd_stats'); resetFilters(); }} className="bg-red-500 p-6 rounded-2xl shadow-xl text-white transform hover:scale-105 transition-all cursor-pointer">
                            <p className="text-xs font-black uppercase opacity-80 tracking-widest">Patients Operated</p>
                            <p className="text-4xl font-black mt-2">{dashboardStats.patientsOperated}</p>
                        </div>
                        <div onClick={() => { setDashboardView('report_stats'); resetFilters(); }} className="bg-green-600 p-6 rounded-2xl shadow-xl text-white transform hover:scale-105 transition-all cursor-pointer">
                            <p className="text-xs font-black uppercase opacity-80 tracking-widest">Lab Orders</p>
                            <p className="text-4xl font-black mt-2">{dashboardStats.reportsOrdered}</p>
                        </div>
                        <div onClick={() => { setDashboardView('rx_stats'); resetFilters(); }} className="bg-amber-500 p-6 rounded-2xl shadow-xl text-white transform hover:scale-105 transition-all cursor-pointer">
                            <p className="text-xs font-black uppercase opacity-80 tracking-widest">Prescriptions</p>
                            <p className="text-4xl font-black mt-2">{dashboardStats.drugsPrescribedCount}</p>
                        </div>
                    </div>

                    {/* Collection Summary Section */}
                    <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-200">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Financial Collection Analytics</h3>
                            <div className="flex gap-4 items-center">
                                <input type="date" value={dashDateStart} onChange={e => setDashDateStart(e.target.value)} className="border rounded-lg px-2 py-1 text-xs font-bold" />
                                <span className="font-bold text-slate-400">-</span>
                                <input type="date" value={dashDateEnd} onChange={e => setDashDateEnd(e.target.value)} className="border rounded-lg px-2 py-1 text-xs font-bold" />
                            </div>
                        </div>
                        
                        {(() => {
                            const { opdTotal, labTotal, usgTotal, ipdTotal, total } = calculateCollections();
                            return (
                                <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                                    <div className="col-span-1 md:col-span-5 bg-slate-50 p-4 rounded-xl border border-slate-200 flex justify-between items-center">
                                        <p className="text-sm font-black text-slate-500 uppercase">Total Period Collection</p>
                                        <p className="text-3xl font-black text-slate-800">₹{total.toLocaleString()}</p>
                                    </div>
                                    <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                                        <p className="text-[10px] font-black text-blue-500 uppercase">OPD (Consultation)</p>
                                        <p className="text-xl font-black text-blue-700">₹{opdTotal.toLocaleString()}</p>
                                    </div>
                                    <div className="p-4 bg-green-50 rounded-xl border border-green-100">
                                        <p className="text-[10px] font-black text-green-500 uppercase">Laboratory</p>
                                        <p className="text-xl font-black text-green-700">₹{labTotal.toLocaleString()}</p>
                                    </div>
                                    <div className="p-4 bg-purple-50 rounded-xl border border-purple-100">
                                        <p className="text-[10px] font-black text-purple-500 uppercase">Ultrasound (USG)</p>
                                        <p className="text-xl font-black text-purple-700">₹{usgTotal.toLocaleString()}</p>
                                    </div>
                                    <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                                        <p className="text-[10px] font-black text-red-500 uppercase">IPD / Day Care</p>
                                        <p className="text-xl font-black text-red-700">₹{ipdTotal.toLocaleString()}</p>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                  </>
              )}

              {/* Drill-Down Views */}
              {dashboardView !== 'overview' && (
                  <div className="space-y-4">
                      <div className="flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                          <h3 className="text-lg font-black text-slate-800 uppercase">
                              {dashboardView === 'rx_stats' ? 'Prescription Analysis' : 
                               dashboardView === 'opd_stats' ? 'OPD Patient Records' : 
                               dashboardView === 'ipd_stats' ? 'Admissions & Surgeries' : 'Lab Reports Log'}
                          </h3>
                          <div className="flex gap-4 items-center">
                              <input placeholder="Search..." value={dashSearch} onChange={e => setDashSearch(e.target.value)} className="border rounded-xl px-4 py-2 text-xs font-bold" />
                              <input type="date" value={dashDateStart} onChange={e => setDashDateStart(e.target.value)} className="border rounded-xl px-4 py-2 text-xs font-bold" />
                              <input type="date" value={dashDateEnd} onChange={e => setDashDateEnd(e.target.value)} className="border rounded-xl px-4 py-2 text-xs font-bold" />
                              <button onClick={() => setDashboardView('overview')} className="bg-slate-800 text-white px-6 py-2 rounded-xl font-black uppercase text-[10px] tracking-widest">Back to Dashboard</button>
                          </div>
                      </div>

                      {dashboardView === 'rx_stats' && renderPrescriptionStats()}
                      {dashboardView === 'opd_stats' && renderPatientStats('opd')}
                      {dashboardView === 'ipd_stats' && renderPatientStats('ipd')}
                      {dashboardView === 'report_stats' && renderReportStats()}
                  </div>
              )}
          </div>
      )}

      {/* ... (Rest of UI Tabs logic queue/edd remains unchanged) ... */}
      {activeTab === 'queue' && (
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-200">
          <div className="p-6 border-b bg-slate-50 flex justify-between items-center">
             <div className="flex items-center gap-2 bg-slate-100 p-2 rounded-xl">
                <span className="text-[10px] font-black text-slate-400 uppercase">View Date:</span>
                <input type="date" value={queueDate} onChange={e => setQueueDate(e.target.value)} className="bg-transparent font-bold text-slate-800 outline-none text-xs" />
             </div>
          </div>
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                <th className="px-8 py-5">Patient Identity</th>
                <th className="px-8 py-5">Vitals</th>
                <th className="px-8 py-5">Complaints Snapshot</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pendingVisits.map(v => (
                <tr key={v.id} className={`${v.callingStatus === 'called' ? 'bg-green-50 animate-pulse' : 'hover:bg-slate-50'}`}>
                  <td className="px-8 py-6">
                    <p className="font-black text-slate-800 text-lg">{v.patient?.name}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{v.patient?.mobile} | {v.patient?.age}</p>
                  </td>
                  <td className="px-8 py-6">
                    <div className="grid grid-cols-2 gap-1 text-[10px] font-mono text-slate-600">
                      <span>BP: <b>{v.vitals?.bp}</b></span>
                      <span>PLS: <b>{v.vitals?.pulse}</b></span>
                      <span>WT: <b>{v.vitals?.weight}kg</b></span>
                      <span>O2: <b>{v.vitals?.spo2}%</b></span>
                    </div>
                  </td>
                  <td className="px-8 py-6 max-w-[200px]">
                    <p className="text-xs text-slate-600 font-bold line-clamp-2 italic">{v.complaints || 'No complaints noted'}</p>
                    {v.parentVisitId && <p className="text-[9px] text-purple-600 mt-1 uppercase font-black tracking-widest">Follow-up Case Link: {v.parentVisitId.slice(-4)}</p>}
                  </td>
                  <td className="px-8 py-6 text-right space-x-2">
                    <button onClick={() => onCallPatient(v.patient?.name || '')} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg transition-all active:scale-95">Call</button>
                    <button onClick={() => { setSelectedPatient(v.patient || null); setShowOrderModal(true); }} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg transition-all active:scale-95">Case</button>
                  </td>
                </tr>
              ))}
              {pendingVisits.length === 0 && (
                  <tr><td colSpan={4} className="px-8 py-12 text-center text-slate-400 italic">No waiting patients for {queueDate}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* EDD View */}
      {activeTab === 'edd' && (
        <div className="space-y-8">
            {eddGroups.map((group, idx) => (
                <div key={idx} className="bg-white rounded-2xl shadow-xl border border-pink-100 overflow-hidden">
                    <div className="bg-pink-50 p-4 border-b border-pink-100 flex justify-between items-center">
                        <h3 className="font-black text-pink-600 uppercase tracking-widest">{group.month}</h3>
                        <span className="bg-white text-pink-500 px-3 py-1 rounded-full text-xs font-bold">{group.patients.length} Deliveries</span>
                    </div>
                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {group.patients.map(p => (
                            <div key={p.id} className="p-4 border border-pink-50 rounded-xl hover:bg-pink-50/50 transition-colors cursor-pointer" onClick={() => { setSelectedPatient(p); setShowOrderModal(true); }}>
                                <p className="font-black text-slate-800">{p.name}</p>
                                <div className="flex justify-between mt-2 text-xs">
                                    <span className="text-slate-500 font-bold">EDD: {new Date(p.pregnancyInfo!.edd).toLocaleDateString()}</span>
                                    <span className="text-pink-500 font-bold">{p.pregnancyInfo!.pog}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
            {eddGroups.length === 0 && <div className="text-center py-20 text-slate-400 font-bold uppercase tracking-widest">No obstetric patients with EDD found.</div>}
        </div>
      )}

      {/* Main Order Modal */}
      {showOrderModal && selectedPatient && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
           <div className="bg-white rounded-3xl shadow-2xl w-full max-w-7xl max-h-[95vh] overflow-auto p-8 border border-slate-100 flex flex-col">
             {/* ... (Keep Modal Content same, it uses local state mostly) ... */}
             <div className="flex justify-between items-start mb-6 shrink-0">
                <div>
                   <h2 className="text-4xl font-black text-slate-900 uppercase tracking-tighter">{selectedPatient.name}</h2>
                   <p className="text-xs font-black text-blue-600 uppercase tracking-widest mt-1">{selectedPatient.type} • Clinical Consultation</p>
                </div>
                <div className="flex gap-4">
                  {selectedPatient.type === 'obstetric' && (
                      <button onClick={(e) => { e.stopPropagation(); setShowAncModal(true); }} className="bg-pink-100 text-pink-700 px-6 py-2 rounded-xl font-black uppercase text-[10px] tracking-widest border border-pink-200 shadow-sm transition-all hover:bg-pink-200">
                          👶 ANC Case Sheet
                      </button>
                  )}
                  <button onClick={() => setShowPastVisitsModal(true)} className="bg-orange-50 text-orange-700 px-6 py-2 rounded-xl font-black uppercase text-[10px] tracking-widest border border-orange-200 shadow-sm transition-all hover:bg-orange-100">
                     🕒 Past Visits & Reports
                  </button>
                  <button onClick={handleOpenBilling} className="bg-green-100 text-green-800 border-green-200 border px-6 py-2 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-sm hover:bg-green-200">💵 Collect Payment</button>
                  <button onClick={handleAiAssist} disabled={isAiLoading} className="bg-purple-50 text-purple-600 px-6 py-2 rounded-xl font-black uppercase text-[10px] tracking-widest border border-purple-100 shadow-sm transition-all flex items-center gap-1 hover:bg-purple-100 disabled:opacity-50">
                    {isAiLoading ? '⏳ Gen...' : '✨ AI Assist'}
                  </button>
                  <button onClick={() => handleSaveCaseData()} className="bg-blue-50 text-blue-600 px-6 py-2 rounded-xl font-black uppercase text-[10px] tracking-widest border border-blue-100 shadow-sm transition-all">💾 Save Changes</button>
                  <button onClick={() => setShowOrderModal(false)} className="bg-slate-100 hover:bg-slate-200 text-slate-500 w-12 h-12 rounded-full flex items-center justify-center text-3xl font-light transition-all">&times;</button>
                </div>
             </div>

             {/* Dynamic Content Based on Prescription Mode */}
             {prescriptionMode === 'digital' ? (
                 <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-grow overflow-y-auto custom-scrollbar pr-2">
                   {/* ... (Keep Left Columns) ... */}
                   <div className="lg:col-span-5 space-y-6">
                      {/* Complaints */}
                      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 relative">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2 mb-3">1. Complaints</h3>
                        <textarea value={localComplaints} onChange={e => setLocalComplaints(e.target.value)} className="w-full h-24 text-sm bg-white border border-slate-200 rounded-xl px-4 py-3 font-bold focus:ring-4 focus:ring-blue-50 outline-none transition-all resize-none" placeholder="Primary complaints..."/>
                        <div className="absolute top-6 right-6 flex gap-1">
                          <button onClick={() => setTemplateConfig({ isOpen: true, type: 'complaints' })} className="bg-white p-1 rounded-lg border border-slate-100 text-sm shadow-sm">📋</button>
                          <button onClick={() => handleSaveTemplate('complaints', localComplaints)} className="bg-white p-1 rounded-lg border border-slate-100 text-sm shadow-sm">💾</button>
                        </div>
                      </div>

                      {/* Obstetric History */}
                      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 relative">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2 mb-3">2. Obstetric History</h3>
                        <input value={localVisitOH} onChange={e => setLocalVisitOH(e.target.value)} className="w-full text-sm bg-white border border-slate-200 rounded-xl px-4 py-3 font-bold focus:ring-4 focus:ring-blue-50 outline-none transition-all" placeholder="G_P_L_A_ status (one line)..."/>
                        <div className="absolute top-6 right-6">
                            <button onClick={() => setTemplateConfig({ isOpen: true, type: 'oh' })} className="bg-white p-1 rounded-lg border border-slate-100 text-sm shadow-sm">📋</button>
                        </div>
                      </div>

                      {/* Menstrual History */}
                      <div className="bg-pink-50 p-6 rounded-2xl border-pink-100 relative space-y-4">
                        <h3 className="text-[10px] font-black text-pink-600 uppercase tracking-widest border-b border-pink-200 pb-2 mb-3">3. Menstrual History</h3>
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="text-[8px] font-black text-pink-400 uppercase block mb-1">LMP Date</label>
                                {selectedPatient.pregnancyInfo?.lmp ? (
                                    <div className="w-full bg-pink-100/50 border border-pink-200 rounded-lg px-2 py-1.5 text-xs font-bold text-pink-800">
                                        {selectedPatient.pregnancyInfo.lmp}
                                    </div>
                                ) : (
                                    <input type="date" value={localLmp} onChange={e => { setLocalLmp(e.target.value); calculateEdd(e.target.value); }} className="w-full bg-white border border-pink-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none" />
                                )}
                            </div>
                            <div>
                                <label className="text-[8px] font-black text-pink-400 uppercase block mb-1">EDD</label>
                                <input type="date" value={localEdd} onChange={e => setLocalEdd(e.target.value)} className="w-full bg-white border border-pink-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none" />
                            </div>
                            <div>
                                <label className="text-[8px] font-black text-pink-400 uppercase block mb-1">POG</label>
                                <input value={localPog} onChange={e => setLocalPog(e.target.value)} className="w-full bg-white border border-pink-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none" placeholder="e.g. 12w 4d" />
                            </div>
                        </div>
                        <textarea value={localMH} onChange={e => setLocalMH(e.target.value)} className="w-full h-20 text-sm bg-white border border-pink-200 rounded-xl px-4 py-3 font-bold focus:ring-4 focus:ring-pink-100 outline-none transition-all resize-none" placeholder="Cycle regularity, flow details..."/>
                        <div className="absolute top-6 right-6">
                          <button onClick={() => setTemplateConfig({ isOpen: true, type: 'mh' })} className="bg-white p-1 rounded-lg border border-pink-100 text-sm shadow-sm">📋</button>
                        </div>
                      </div>
                   </div>

                   <div className="lg:col-span-4 space-y-6">
                      {/* General Exam */}
                      <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 relative space-y-4">
                        <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-widest border-b border-blue-200 pb-2 mb-1">4. General Examination</h3>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-white p-2 rounded-xl border border-blue-100">
                                <label className="text-[8px] font-black text-blue-400 uppercase block mb-1">Pulse (bpm)</label>
                                <input value={localPulse} onChange={e => setLocalPulse(e.target.value)} className="w-full text-xs font-black outline-none" placeholder="--" />
                            </div>
                            <div className="bg-white p-2 rounded-xl border border-blue-100">
                                <label className="text-[8px] font-black text-blue-400 uppercase block mb-1">BP (mmHg)</label>
                                <input value={localBp} onChange={e => setLocalBp(e.target.value)} className="w-full text-xs font-black outline-none" placeholder="120/80" />
                            </div>
                            <div className="bg-white p-2 rounded-xl border border-blue-100">
                                <label className="text-[8px] font-black text-blue-400 uppercase block mb-1">Weight (kg)</label>
                                <input value={localWeight} onChange={e => setLocalWeight(e.target.value)} className="w-full text-xs font-black outline-none" placeholder="--" />
                            </div>
                            <div className="bg-white p-2 rounded-xl border border-blue-100">
                                <label className="text-[8px] font-black text-blue-400 uppercase block mb-1">SpO2 (%)</label>
                                <input value={localSpo2} onChange={e => setLocalSpo2(e.target.value)} className="w-full text-xs font-black outline-none" placeholder="98" />
                            </div>
                        </div>
                        <textarea value={localGenNotes} onChange={e => setLocalGenNotes(e.target.value)} className="w-full h-20 text-sm bg-white border border-blue-200 rounded-xl px-4 py-3 font-bold focus:ring-4 focus:ring-blue-100 outline-none transition-all resize-none" placeholder="Pallor, Edema, Icterus..."/>
                        <div className="absolute top-6 right-6">
                          <button onClick={() => setTemplateConfig({ isOpen: true, type: 'gen_exam' })} className="bg-white p-1 rounded-lg border border-blue-100 text-sm shadow-sm">📋</button>
                        </div>
                      </div>

                      {/* Physical Exam */}
                      <div className="bg-white p-6 rounded-2xl border border-slate-200 relative h-[180px] flex flex-col">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2 mb-3 shrink-0">5. Physical Examination</h3>
                        <textarea value={localPhysExam} onChange={e => setLocalPhysExam(e.target.value)} className="flex-grow w-full text-sm bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 font-bold focus:ring-4 focus:ring-blue-50 outline-none transition-all resize-none" placeholder="Systemic examination..."/>
                        <div className="absolute top-6 right-6 flex gap-1">
                          <button onClick={() => setTemplateConfig({ isOpen: true, type: 'phys_exam' })} className="bg-white p-1 rounded-lg border border-slate-100 text-sm shadow-sm">📋</button>
                          <button onClick={() => handleSaveTemplate('phys_exam', localPhysExam)} className="bg-white p-1 rounded-lg border border-slate-100 text-sm shadow-sm">💾</button>
                        </div>
                      </div>

                      {/* Rx */}
                      <div className="bg-green-50/30 p-6 rounded-2xl border-2 border-green-100 relative min-h-[250px] flex flex-col">
                        <h3 className="text-[10px] font-black text-green-600 uppercase tracking-widest border-b border-green-100 pb-2 mb-3 shrink-0">6. Prescription (Rx)</h3>
                        <div className="absolute top-2 right-6 flex gap-2">
                            <button onClick={() => handleTranslateRx('Marathi')} disabled={isTranslating} className="text-[9px] bg-white border border-green-200 px-2 py-1 rounded-lg uppercase font-bold text-green-700 hover:bg-green-50">{isTranslating ? '...' : 'अ'}</button>
                            <button onClick={() => handleTranslateRx('Hindi')} disabled={isTranslating} className="text-[9px] bg-white border border-green-200 px-2 py-1 rounded-lg uppercase font-bold text-green-700 hover:bg-green-50">{isTranslating ? '...' : 'अ'}</button>
                        </div>
                        <textarea value={localRx} onChange={e => setLocalRx(e.target.value)} className="flex-grow w-full text-lg bg-white border border-green-200 rounded-xl px-4 py-3 font-black focus:ring-4 focus:ring-green-50 outline-none transition-all resize-none text-slate-800" placeholder="Medications..."/>
                        <div className="absolute bottom-4 right-6 flex gap-1">
                          <button onClick={() => setShowQuickRxModal(true)} className="bg-white p-1 rounded-lg border border-green-100 text-sm shadow-sm font-bold px-2 text-green-600">Quick Rx</button>
                          <button onClick={() => setTemplateConfig({ isOpen: true, type: 'prescription' })} className="bg-white p-1 rounded-lg border border-green-100 text-sm shadow-sm">📋</button>
                          <button onClick={() => handleSaveTemplate('prescription', localRx)} className="bg-white p-1 rounded-lg border border-green-100 text-sm shadow-sm">💾</button>
                        </div>
                      </div>

                      {/* Remarks & Follow Up */}
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1 ml-1">Remarks</label>
                              <textarea value={localRemarks} onChange={e => setLocalRemarks(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 font-bold text-sm h-20 resize-none" placeholder="Special instructions..."/>
                          </div>
                          <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase mb-1 ml-1">Follow-up Date</label>
                              <input type="date" value={localFollowUpDate} onChange={e => setLocalFollowUpDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold" />
                          </div>
                      </div>
                   </div>

                   {/* Right Column Labs */}
                   <div className="lg:col-span-3 space-y-6">
                     {/* ... (Keep Lab Selection UI) ... */}
                     <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">Labs Order</h3>
                     <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-4 max-h-[600px] overflow-y-auto custom-scrollbar">
                        <div className="grid grid-cols-2 gap-2">
                            {['cbc', 'serology', 'urine', 'crp', 'bloodSugar', 'bloodGroup', 'widal', 'semen'].map(test => (
                                <label key={test} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-slate-100 rounded">
                                    <input 
                                        type="checkbox" 
                                        checked={labSelection[test as keyof SelectedTests] as boolean} 
                                        onChange={() => toggleLabTest(test as keyof SelectedTests)}
                                        className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500 border-gray-300"
                                    />
                                    <span className="text-[10px] font-black uppercase text-slate-700">{test}</span>
                                </label>
                            ))}
                        </div>
                        {/* Granular Hormone Selection */}
                        <div className="bg-white p-3 rounded-xl border border-purple-100">
                            <label className="flex items-center gap-2 cursor-pointer mb-2 border-b border-purple-50 pb-2">
                                <input 
                                    type="checkbox" 
                                    checked={labSelection.hormone} 
                                    onChange={() => toggleLabTest('hormone')}
                                    className="h-4 w-4 rounded text-purple-600 focus:ring-purple-500 border-gray-300"
                                />
                                <span className="text-[10px] font-black uppercase text-purple-700">Hormone Panel</span>
                            </label>
                            {labSelection.hormone && (
                                <div className="grid grid-cols-2 gap-2 pl-2">
                                    {(['tsh', 'ft3', 'ft4', 't3', 't4', 'fsh', 'lh', 'prolactin', 'amh', 'hba1c'] as Array<keyof HormoneReportSelection>).map(hKey => (
                                        <label key={hKey} className="flex items-center gap-2 cursor-pointer">
                                            <input 
                                                type="checkbox"
                                                checked={labSelection.hormoneDetails?.[hKey] || false}
                                                onChange={() => toggleHormoneDetail(hKey)}
                                                className="h-3 w-3 rounded text-purple-500 focus:ring-purple-400 border-gray-300"
                                            />
                                            <span className="text-[9px] font-bold text-slate-600 uppercase">{hKey}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="flex gap-2 pt-2">
                            <button onClick={prefillANCProfile} className="flex-1 bg-pink-100 text-pink-700 hover:bg-pink-200 py-2 rounded-lg font-black uppercase text-[9px] tracking-widest transition-all">Select ANC</button>
                            <button onClick={handlePlaceLabOrder} className="flex-[2] bg-blue-600 text-white hover:bg-blue-700 py-2 rounded-lg font-black uppercase text-[9px] tracking-widest shadow-md transition-all active:scale-95">Place Lab Order</button>
                        </div>
                     </div>
                     {/* Radiology */}
                     <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Radiology</h3>
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={handleOrderUSG} className="w-full bg-slate-200 text-slate-700 hover:bg-slate-300 py-3 rounded-xl font-black uppercase tracking-widest text-[9px]">Order USG ({billingRates.ultrasound?.price || 800}/-)</button>
                            <button onClick={() => setShowUsgModal(true)} className="w-full bg-slate-200 text-slate-700 hover:bg-slate-300 py-3 rounded-xl font-black uppercase tracking-widest text-[9px]">Print Referral</button>
                        </div>
                     </div>
                     <div className="pt-4 border-t space-y-3">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Recent Tests</h3>
                        <div className="max-h-[250px] overflow-auto space-y-2 pr-2 custom-scrollbar">
                           {labOrders.filter(o => o.patientId === selectedPatient.id).map(o => (
                             <div key={o.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <span className="text-[9px] font-black uppercase text-slate-500 truncate max-w-[120px]">{Object.keys(o.tests).filter(k=>k!=='hormoneDetails' && (o.tests as any)[k]).join(', ') || (o.ultrasound ? 'ULTRASOUND' : 'STUDY')}</span>
                                {o.status === 'completed' && <button onClick={() => setShowReportPreview(o)} className="text-blue-600 text-[9px] font-black underline">View</button>}
                             </div>
                           ))}
                        </div>
                     </div>
                   </div>
                 </div>
             ) : (
                 // MANUAL MODE LAYOUT (Preserving existing Manual Mode logic)
                 <div className="flex flex-col gap-6 h-full overflow-y-auto custom-scrollbar p-1">
                     {/* ... (Keep Manual Mode UI) ... */}
                     <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 mt-auto">
                          <div className="grid grid-cols-2 gap-6">
                              <div>
                                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1 ml-1">Remarks</label>
                                  <textarea value={localRemarks} onChange={e => setLocalRemarks(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-sm h-24 resize-none focus:ring-4 focus:ring-slate-100 outline-none" placeholder="Special instructions..."/>
                              </div>
                              <div>
                                  <label className="block text-[10px] font-black text-slate-400 uppercase mb-1 ml-1">Follow-up Date</label>
                                  <input type="date" value={localFollowUpDate} onChange={e => setLocalFollowUpDate(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 font-bold focus:ring-4 focus:ring-slate-100 outline-none" />
                              </div>
                          </div>
                     </div>
                 </div>
             )}

             <div className="mt-8 pt-8 border-t flex flex-wrap gap-4 shrink-0">
                <button onClick={handlePrintPrescription} className="flex-1 bg-slate-900 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3">
                  <span>🖨️</span> Print Prescription (A4)
                </button>
                <button 
                  onClick={() => setShowBedSelectionForIpd(true)}
                  className="flex-1 bg-blue-50 text-blue-600 py-5 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl transition-all border border-blue-100 hover:bg-blue-100 active:scale-95 flex items-center justify-center gap-3"
                >
                  <span>🏥</span> Admit to Ward
                </button>
                <button 
                  onClick={() => { 
                      const v = visits.find(vis => vis.patientId === selectedPatient.id && !vis.isApproved) || visits.find(vis => vis.patientId === selectedPatient.id && vis.isApproved);
                      if (v) handleApprove(v.id); 
                  }}
                  className="flex-1 bg-green-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl transition-all active:scale-95 flex items-center justify-center gap-3"
                >
                  <span>✅</span> Complete Consultation
                </button>
                <button 
                  onClick={() => { 
                      const v = visits.find(vis => vis.patientId === selectedPatient.id && !vis.isApproved) || visits.find(vis => vis.patientId === selectedPatient.id && vis.isApproved);
                      if (v) {
                          handleSaveCaseData(true);
                          const updatedVisits = visits.map(vis => vis.id === v.id ? { ...vis, caseStatus: 'closed', isApproved: true, callingStatus: 'waiting' } as VisitRecord : vis);
                          onUpdateVisits(updatedVisits);
                          setShowOrderModal(false);
                      }
                  }}
                  className="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 py-5 px-8 rounded-2xl font-black uppercase tracking-widest text-xs shadow-sm transition-all active:scale-95 flex items-center justify-center gap-3"
                >
                  <span>🔚</span> End Case
                </button>
             </div>
           </div>
        </div>
      )}

      {/* ... (Keep other modals: Quick Rx, Template, ANC, Billing, Report) ... */}
      
      {/* Quick Rx Modal */}
      {showQuickRxModal && (
          <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl p-6 max-w-4xl w-full max-h-[90vh] flex flex-col relative">
                  <h3 className="text-xl font-black text-slate-800 uppercase mb-4">Quick Prescription Builder</h3>
                  
                  <div className="flex gap-4 h-full overflow-hidden">
                      {/* Groups */}
                      <div className="w-1/4 border-r pr-4 overflow-y-auto">
                          {medicationMaster?.groups.map(g => (
                              <button key={g} onClick={() => setQRxGroup(g)} className={`w-full text-left p-3 rounded-xl font-bold text-xs uppercase mb-2 ${qRxGroup === g ? 'bg-purple-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                                  {g}
                              </button>
                          ))}
                      </div>
                      
                      {/* Drugs with Stock Check */}
                      <div className="w-1/4 border-r pr-4 overflow-y-auto">
                          {medicationMaster?.drugs.filter(d => d.group === qRxGroup).map(d => {
                              const stock = getStockLevel(d.name);
                              const isSelected = qRxSelectedDrugs.includes(d.name);
                              
                              return (
                                  <button 
                                      key={d.id} 
                                      onClick={() => handleDrugClick(d.name)} 
                                      className={`w-full text-left p-3 rounded-xl font-bold text-xs mb-2 border transition-all flex justify-between items-center group
                                          ${isSelected ? 'bg-green-100 text-green-700 border-green-200' : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50'}
                                          ${stock <= 0 && !isSelected ? 'text-red-500 border-red-100 bg-red-50/50' : ''}
                                      `}
                                  >
                                      <span>{d.name}</span>
                                      {stock <= 0 && !isSelected && (
                                          <span className="text-[10px] font-black bg-red-100 text-red-600 px-1.5 py-0.5 rounded ml-2">OUT</span>
                                      )}
                                  </button>
                              )
                          })}
                      </div>
                      
                      {/* Actions */}
                      <div className="flex-grow flex flex-col">
                          <div className="mb-4">
                              <button onClick={handleAddToStaging} disabled={qRxSelectedDrugs.length === 0} className="w-full bg-blue-600 text-white py-2 rounded-xl font-black uppercase text-xs disabled:bg-slate-200">Add Selected to Rx</button>
                          </div>
                          <div className="flex-grow overflow-y-auto bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                              {qRxStaging.map((item, i) => (
                                  <div key={i} className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm text-xs">
                                      <p className="font-black text-slate-800 mb-2">{item.drug}</p>
                                      <div className="grid grid-cols-4 gap-2 mb-2">
                                          <input value={item.dose} onChange={e => updateStagingItem(i, 'dose', e.target.value)} className="border p-1 rounded font-bold text-slate-600" placeholder="Dose" />
                                          <select value={item.freq} onChange={e => updateStagingItem(i, 'freq', e.target.value)} className="border p-1 rounded font-bold text-slate-600">
                                              <option value="">Freq</option>
                                              {medicationMaster?.frequencies.map(f => <option key={f} value={f}>{f}</option>)}
                                          </select>
                                          <input value={item.duration} onChange={e => updateStagingItem(i, 'duration', e.target.value)} className="border p-1 rounded font-bold text-slate-600" placeholder="Days" type="number" />
                                          <select value={item.advice} onChange={e => updateStagingItem(i, 'advice', e.target.value)} className="border p-1 rounded font-bold text-slate-600">
                                              <option value="">Advice</option>
                                              {medicationMaster?.instructions.map(a => <option key={a} value={a}>{a}</option>)}
                                          </select>
                                      </div>
                                  </div>
                              ))}
                          </div>
                          <div className="mt-4 flex gap-2">
                              <button onClick={handleQuickRxConfirm} className="flex-1 bg-green-600 text-white py-3 rounded-xl font-black uppercase text-xs">Insert into Rx</button>
                              <button onClick={() => setShowQuickRxModal(false)} className="flex-1 bg-slate-200 text-slate-800 py-3 rounded-xl font-black uppercase text-xs">Close</button>
                          </div>
                      </div>
                  </div>

                  {/* Substitution Modal Overlay */}
                  {showSubstitutionModal && substitutionSource && (
                      <div className="absolute inset-0 bg-white/95 backdrop-blur-sm z-[70] flex items-center justify-center p-8 rounded-2xl">
                          <div className="w-full max-w-lg">
                              <div className="text-center mb-6">
                                  <span className="text-4xl">⚠️</span>
                                  <h4 className="text-xl font-black text-red-600 uppercase mt-2">Out of Stock</h4>
                                  <p className="font-bold text-slate-800 text-lg mt-1">{substitutionSource.name}</p>
                                  <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">
                                      Generic: {substitutionSource.generic || 'Unknown'}
                                  </p>
                              </div>

                              <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden mb-6">
                                  <div className="bg-green-100 px-4 py-2 border-b border-green-200">
                                      <p className="text-[10px] font-black text-green-800 uppercase tracking-widest">Available Substitutes (Same Salt)</p>
                                  </div>
                                  <div className="max-h-48 overflow-y-auto">
                                      {getAlternatives(substitutionSource.name).map(alt => (
                                          <button 
                                              key={alt.id}
                                              onClick={() => handleSubstitute(alt.name)}
                                              className="w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-green-50 flex justify-between items-center group transition-colors"
                                          >
                                              <div>
                                                  <p className="font-bold text-slate-800 text-sm group-hover:text-green-700">{alt.name}</p>
                                                  <p className="text-[10px] text-slate-400 font-bold">Qty: {alt.quantity}</p>
                                              </div>
                                              <span className="bg-white border border-slate-200 text-slate-500 px-3 py-1 rounded-lg text-[10px] font-black uppercase group-hover:bg-green-600 group-hover:text-white group-hover:border-green-600">Select</span>
                                          </button>
                                      ))}
                                      {getAlternatives(substitutionSource.name).length === 0 && (
                                          <p className="p-6 text-center text-slate-400 text-xs italic">No matching substitutes found in pharmacy stock.</p>
                                      )}
                                  </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                  <button onClick={handleForceAdd} className="bg-slate-200 hover:bg-slate-300 text-slate-700 py-3 rounded-xl font-black uppercase text-[10px] tracking-widest">Use Original Anyway</button>
                                  <button onClick={() => { setShowSubstitutionModal(false); setSubstitutionSource(null); }} className="bg-red-50 hover:bg-red-100 text-red-600 py-3 rounded-xl font-black uppercase text-[10px] tracking-widest border border-red-100">Cancel</button>
                              </div>
                          </div>
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* Template Selection Modal */}
      {templateConfig.isOpen && (
          <div className="fixed inset-0 bg-black/80 z-[70] flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] flex flex-col">
                  <h3 className="text-lg font-black text-slate-800 uppercase mb-4">Select Template</h3>
                  <div className="overflow-y-auto flex-grow space-y-2 custom-scrollbar">
                      {clinicalTemplates.filter(t => t.category === templateConfig.type).map(t => (
                          <button key={t.id} onClick={() => useTemplate(t)} className="w-full text-left p-4 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors">
                              <p className="font-bold text-slate-800 text-sm mb-1">{t.title}</p>
                              <p className="text-xs text-slate-500 line-clamp-2 italic">{t.content}</p>
                          </button>
                      ))}
                      {clinicalTemplates.filter(t => t.category === templateConfig.type).length === 0 && (
                          <p className="text-center text-slate-400 italic py-8">No templates found for this category.</p>
                      )}
                  </div>
                  <button onClick={() => setTemplateConfig({isOpen: false, type: null})} className="mt-4 bg-slate-200 text-slate-800 py-3 rounded-xl font-bold uppercase text-xs w-full">Cancel</button>
              </div>
          </div>
      )}

      {/* ANC Modal */}
      {showAncModal && selectedPatient && selectedPatient.type === 'obstetric' && (
          <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl p-8 max-w-4xl w-full h-[90vh] overflow-y-auto relative">
                  <button onClick={() => setShowAncModal(false)} className="absolute top-6 right-6 text-3xl font-light text-slate-400 hover:text-slate-600">&times;</button>
                  <h2 className="text-3xl font-black text-pink-600 uppercase tracking-tighter mb-2">Antenatal Care Record</h2>
                  <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-8">{selectedPatient.name} ({selectedPatient.age})</p>
                  <div className="grid grid-cols-2 gap-8 mb-8">
                      <div className="bg-pink-50 p-6 rounded-2xl border border-pink-100">
                          <h4 className="font-black text-pink-400 uppercase text-xs tracking-widest mb-4">Pregnancy Dating</h4>
                          <div className="space-y-3">
                              <div className="flex justify-between border-b border-pink-100 pb-2"><span className="text-sm font-bold text-slate-600">LMP</span><span className="text-sm font-black text-slate-800">{selectedPatient.pregnancyInfo?.lmp || 'Not Set'}</span></div>
                              <div className="flex justify-between border-b border-pink-100 pb-2"><span className="text-sm font-bold text-slate-600">EDD</span><span className="text-sm font-black text-slate-800">{selectedPatient.pregnancyInfo?.edd || 'Not Set'}</span></div>
                              <div className="flex justify-between"><span className="text-sm font-bold text-slate-600">Current POG</span><span className="text-sm font-black text-pink-600">{selectedPatient.pregnancyInfo?.pog || 'Not Set'}</span></div>
                          </div>
                      </div>
                      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                           <h4 className="font-black text-slate-400 uppercase text-xs tracking-widest mb-4">Previous History</h4>
                           <p className="text-sm font-bold text-slate-800 whitespace-pre-wrap">{selectedPatient.obstetricHistory || 'No history recorded.'}</p>
                      </div>
                  </div>
                  <h4 className="font-black text-slate-800 uppercase text-sm tracking-widest mb-4">Visit History</h4>
                  <table className="w-full text-left text-sm">
                      <thead className="bg-slate-100 text-xs font-black text-slate-500 uppercase"><tr><th className="p-3 rounded-l-lg">Date</th><th className="p-3">Weight</th><th className="p-3">BP</th><th className="p-3">POG</th><th className="p-3">Investigations</th><th className="p-3">Rx Prescribed</th><th className="p-3 rounded-r-lg">Notes</th></tr></thead>
                      <tbody className="divide-y">
                          {visits.filter(v => v.patientId === selectedPatient.id && v.isApproved && (!v.caseStatus || v.caseStatus !== 'closed' || v.parentVisitId === visits.find(vi=>vi.patientId===selectedPatient.id && vi.isApproved && vi.caseStatus !== 'closed')?.parentVisitId)).map(v => {
                              const visitOrders = labOrders.filter(o => o.patientId === selectedPatient.id && new Date(o.timestamp).toISOString().slice(0,10) === v.date);
                              return (
                                <tr key={v.id}>
                                  <td className="p-3 font-bold">{v.date}</td>
                                  <td className="p-3">{v.vitals?.weight}</td>
                                  <td className="p-3">{v.vitals?.bp}</td>
                                  <td className="p-3">{v.visitPog || '-'}</td>
                                  <td className="p-3">
                                      {visitOrders.map((ord, idx) => (
                                          <button key={idx} onClick={() => setShowReportPreview(ord)} className="block text-[10px] bg-blue-50 text-blue-600 font-bold px-2 py-1 rounded mb-1 border border-blue-100 hover:bg-blue-100">
                                              {ord.ultrasound ? 'USG Report' : 'Lab Report'}
                                          </button>
                                      ))}
                                      {visitOrders.length === 0 && <span className="text-xs text-slate-400">None</span>}
                                  </td>
                                  <td className="p-3 text-xs font-medium text-slate-700 whitespace-pre-wrap">{v.prescription || '-'}</td>
                                  <td className="p-3 text-xs italic text-slate-500 max-w-xs truncate">{v.generalExamination}</td>
                                </tr>
                              );
                          })}
                      </tbody>
                  </table>
              </div>
          </div>
      )}

      {/* IPD Bed Selection Modal */}
      {showBedSelectionForIpd && selectedPatient && wards && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl w-full max-w-2xl p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
                  <button onClick={() => setShowBedSelectionForIpd(false)} className="absolute top-6 right-6 text-slate-400 hover:text-slate-900 font-black text-2xl">&times;</button>
                  <h3 className="font-black text-2xl uppercase tracking-tighter mb-4 border-b pb-4">Select Bed For Admission</h3>
                  
                  <div className="space-y-6">
                      {wards.map(ward => (
                          <div key={ward.id} className="border rounded-2xl p-4 overflow-hidden shadow-sm">
                              <h4 className="font-black text-lg bg-slate-100 p-2 rounded-xl mb-4">{ward.name}</h4>
                              <div className="grid grid-cols-4 gap-3">
                                  {ward.beds.map(bed => {
                                      const isOccupied = ipdAdmissions.some(a => a.status === 'active' && a.bedId === bed.id);
                                      return (
                                          <button
                                              key={bed.id}
                                              disabled={isOccupied}
                                              onClick={() => {
                                                  if (onAddAdmission) {
                                                      const newAdm: IpdAdmission = {
                                                          id: 'adm-' + Date.now().toString(),
                                                          patientId: selectedPatient.id,
                                                          admissionDate: new Date().toISOString(),
                                                          wardId: ward.id,
                                                          bedId: bed.id,
                                                          diagnosis: localComplaints || 'Pending Diagnosis',
                                                          status: 'active',
                                                          primaryDoctor: doctorName,
                                                          dailyCharges: 0,
                                                          roundNotes: [], medications: [], nursingNotes: [], fluidBalance: [], charges: []
                                                      };
                                                      onAddAdmission(newAdm);
                                                      alert('Patient admitted to ' + ward.name + ' - Bed ' + bed.number);
                                                      setShowBedSelectionForIpd(false);
                                                      setShowOrderModal(false);
                                                  }
                                              }}
                                              className={`p-3 border-2 rounded-xl text-center font-black transition-all ${isOccupied ? 'bg-red-50 border-red-200 text-red-500 opacity-50 cursor-not-allowed' : 'bg-green-50 border-green-300 text-green-700 hover:bg-green-600 hover:text-white hover:shadow-xl'}`}
                                          >
                                              {bed.number}
                                          </button>
                                      );
                                  })}
                              </div>
                          </div>
                      ))}
                      {wards.length === 0 && <p className="text-center text-slate-500 italic py-8">No wards available.</p>}
                  </div>
              </div>
          </div>
      )}

      {/* Past Visits Modal */}
      {showPastVisitsModal && selectedPatient && (
          <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl p-8 max-w-5xl w-full h-[90vh] overflow-y-auto relative">
                  <button onClick={() => setShowPastVisitsModal(false)} className="absolute top-6 right-6 text-3xl font-light text-slate-400 hover:text-slate-600">&times;</button>
                  <h2 className="text-3xl font-black text-orange-600 uppercase tracking-tighter mb-2">Past Visits & Reports</h2>
                  <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-8">{selectedPatient.name} ({selectedPatient.age})</p>
                  
                  <div className="mb-4">
                      <button onClick={() => {
                          const date = prompt("Enter report date (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
                          const title = prompt("Enter report title:");
                          if (date && title) {
                              onOrderLab({
                                  id: `ext-${Date.now()}`,
                                  patientId: selectedPatient.id,
                                  status: 'completed',
                                  timestamp: Date.now(),
                                  tests: {} as any,
                                  ultrasound: title.toLowerCase().includes('usg') || title.toLowerCase().includes('ultrasound'),
                                  reportData: { title, isExternal: true, externalLink: 'External Report Uploaded on ' + new Date().toLocaleString() } as any
                              });
                          }
                      }} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg uppercase text-[10px] tracking-widest shadow">
                          + Upload External Report
                      </button>
                  </div>

                  <table className="w-full text-left text-sm mt-4">
                      <thead className="bg-slate-100 text-xs font-black text-slate-500 uppercase"><tr><th className="p-3 rounded-l-lg">Date</th><th className="p-3">Visit Type</th><th className="p-3">Vitals</th><th className="p-3">Investigations</th><th className="p-3">Notes & Rx</th><th className="p-3 rounded-r-lg">External</th></tr></thead>
                      <tbody className="divide-y">
                          {visits.filter(v => v.patientId === selectedPatient.id && v.isApproved).sort((a,b) => Date.parse(b.date) - Date.parse(a.date)).map(v => {
                              const visitOrders = labOrders.filter(o => o.patientId === selectedPatient.id && new Date(o.timestamp).toISOString().slice(0,10) === v.date);
                              return (
                                <tr key={v.id}>
                                  <td className="p-3 font-bold">{v.date}</td>
                                  <td className="p-3">{v.visitType}</td>
                                  <td className="p-3 text-[10px]">
                                      BP: {v.vitals?.bp} <br/> W: {v.vitals?.weight}kg
                                  </td>
                                  <td className="p-3">
                                      {visitOrders.map((ord, idx) => (
                                          <button key={idx} onClick={() => {
                                              if ((ord.reportData as any)?.isExternal) {
                                                  alert((ord.reportData as any).title + ' : ' + (ord.reportData as any).externalLink);
                                              } else {
                                                  setShowReportPreview(ord)
                                              }
                                          }} className="block text-[10px] bg-blue-50 text-blue-600 font-bold px-2 py-1 rounded mb-1 border border-blue-100 hover:bg-blue-100 w-full text-left">
                                              📄 {(ord.reportData as any)?.title || (ord.ultrasound ? 'USG Report' : 'Lab Report')}
                                          </button>
                                      ))}
                                      {visitOrders.length === 0 && <span className="text-xs text-slate-400">None</span>}
                                  </td>
                                  <td className="p-3 text-[10px] italic text-slate-600 max-w-xs break-words">
                                      <div className="font-bold">{v.generalExamination || v.complaints}</div>
                                      <div className="text-slate-400 mt-1">{v.prescription}</div>
                                  </td>
                                  <td className="p-3">
                                      <button onClick={() => {
                                          const title = prompt("Enter report title:");
                                          if (title) {
                                              onOrderLab({
                                                  id: `ext-${Date.now()}`,
                                                  patientId: selectedPatient.id,
                                                  status: 'completed',
                                                  timestamp: Date.parse(v.date),
                                                  tests: {} as any,
                                                  ultrasound: title.toLowerCase().includes('usg') || title.toLowerCase().includes('ultrasound'),
                                                  reportData: { title, isExternal: true, externalLink: 'External Report Uploaded on ' + new Date().toLocaleString() } as any
                                              });
                                          }
                                      }} className="text-[10px] bg-slate-100 px-2 py-1 rounded font-bold hover:bg-slate-200">Upload</button>
                                  </td>
                                </tr>
                              );
                          })}
                      </tbody>
                  </table>
              </div>
          </div>
      )}

      {/* Billing Modal */}
      {showBillingModal && currentBillVisit && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
              <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
                  <div className="p-6 border-b bg-slate-50 flex justify-between items-center"><h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Collect Payment</h3><button onClick={() => { setShowBillingModal(false); setCurrentBillVisit(null); }} className="text-slate-400 text-2xl">&times;</button></div>
                  <div className="p-6 overflow-y-auto flex-grow space-y-4">
                      {currentBillVisit.collectedBy && <div className="bg-green-50 border border-green-200 p-3 rounded-xl flex items-center gap-3"><span className="text-xl">✅</span><div><p className="text-xs font-black text-green-700 uppercase">Payment Already Collected</p><p className="text-xs text-green-600">Collected by {currentBillVisit.collectedBy}</p></div></div>}
                      <div><p className="text-[10px] font-black text-slate-400 uppercase mb-2">Billable Items (Editable)</p><div className="space-y-2">{billItems.map((item, idx) => (<div key={idx} className="flex gap-2 items-center"><input value={item.name} onChange={e => { const newItems = [...billItems]; newItems[idx].name = e.target.value; setBillItems(newItems); }} className="flex-grow border rounded-lg px-3 py-2 text-sm font-bold text-slate-700" /><input type="number" value={item.price} onChange={e => { const newItems = [...billItems]; newItems[idx].price = Number(e.target.value); setBillItems(newItems); }} className="w-24 border rounded-lg px-3 py-2 text-sm font-bold text-right" /></div>))}</div></div>
                      <div className="flex justify-end pt-4 border-t border-slate-100"><div className="w-1/2 space-y-2"><div className="flex justify-between text-sm"><span className="text-slate-500 font-bold">Subtotal</span><span className="font-bold">₹{billItems.reduce((a,b)=>a+b.price, 0)}</span></div><div className="flex justify-between items-center gap-2"><span className="text-slate-500 font-bold text-sm">Discount</span><input type="number" value={billDiscount} onChange={e => setBillDiscount(Number(e.target.value))} className="w-20 border rounded-lg px-2 py-1 text-right text-sm font-bold text-red-500" /></div><div className="flex justify-between text-lg pt-2 border-t border-slate-200"><span className="font-black text-slate-800">Grand Total</span><span className="font-black text-blue-600">₹{billItems.reduce((a,b)=>a+b.price, 0) - billDiscount}</span></div></div></div>
                  </div>
                  <div className="p-6 bg-slate-50 border-t grid grid-cols-2 gap-4"><button onClick={() => handleFinalizeBill('cash')} className="bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-black uppercase tracking-widest text-xs shadow-lg">Confirm Cash</button><button onClick={() => handleFinalizeBill('upi')} className="bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-black uppercase tracking-widest text-xs shadow-lg">Confirm UPI</button></div>
              </div>
          </div>
      )}

      {/* Report Preview Modal */}
      {showReportPreview && showReportPreview.reportData && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[120] flex items-center justify-center p-4">
           <div className="bg-slate-200 rounded-3xl w-full max-w-5xl h-[95vh] overflow-hidden flex flex-col shadow-2xl">
              <div className="bg-white p-6 border-b flex justify-between items-center"><div><h3 className="font-black text-slate-900 uppercase tracking-tighter text-xl">Lab Report Viewer</h3><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Read Only Mode</p></div><div className="flex gap-4"><button onClick={() => window.print()} className="bg-blue-600 text-white px-6 py-2 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg hover:bg-blue-700 transition-all">🖨️ Print Report</button><button onClick={() => setShowReportPreview(null)} className="bg-slate-900 text-white px-8 py-3 rounded-2xl font-black uppercase tracking-widest text-[10px] transition-all">Close</button></div></div>
              <div className="flex-grow overflow-auto p-10 flex justify-center bg-slate-100" id="print-container"><div className="origin-top transform scale-90 md:scale-100"><ReportPreview reportData={showReportPreview.reportData} selectedTests={showReportPreview.tests} settings={printSettings} /></div></div>
           </div>
        </div>
      )}
    </div>
  );
};

export default DoctorDashboard;

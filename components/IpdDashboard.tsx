import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Ward,
  Bed,
  Patient,
  IpdAdmission,
  Consultant,
  DailyRoundNote,
  LabourProgressEntry,
  PostOperativeNote,
  ServicePrices,
  IpdCharge,
  IpdPayment,
  IpdMedicationChartEntry,
  NursingNote,
  ClinicalTemplate,
  IpdDischargeSummary,
  IpdAdmissionNote,
  VisitRecord,
  DeliveryDetails,
  IpdRoundNote,
  FluidEntry,
  Vitals,
} from "../types";
import {
  parseDailyRoundNote,
  generatePartographData,
  generateOperativeNote,
  generateDischargeSummary,
  extractVitalsFromImage,
  identifyMedicationFromImage,
  generateAdmissionNote,
  expandNursingNote,
  extractMedicationChartFromImage,
  generateConsent,
  translateText,
} from "../services/geminiService";
import { DEFAULT_PRICES } from "../services/billingService";
import { numberToWords } from "../services/numberToWords";

interface IpdDashboardProps {
  wards: Ward[];
  patients: Patient[];
  visits: VisitRecord[];
  admissions: IpdAdmission[];
  consultants: Consultant[];
  billingRates?: ServicePrices;
  clinicalTemplates: ClinicalTemplate[];
  onUpdateWards: (wards: Ward[]) => void;
  onUpdateAdmissions: (admissions: IpdAdmission[]) => void;
  onUpdateTemplates: (templates: ClinicalTemplate[]) => void;
  onUpdatePatients: (patients: Patient[]) => void;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// --- HELPER FOR AI VOICE ---
const useAiVoiceInput = (onResult: (text: string) => void) => {
  const [isRecording, setIsRecording] = useState(false);
  const start = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Browser does not support voice recognition");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = "en-US";
    recognition.interimResults = false;

    recognition.onstart = () => setIsRecording(true);
    recognition.onend = () => setIsRecording(false);
    recognition.onresult = async (event: any) => {
      const transcript = event.results[0][0].transcript;
      onResult(transcript);
    };
    recognition.start();
  };
  return { isRecording, start };
};

const calculatePregnancy = (dateStr: string) => {
  if (!dateStr) return { lmp: "", edd: "", pog: "" };
  const lmpDate = new Date(dateStr);
  const eddDate = new Date(lmpDate);
  eddDate.setDate(eddDate.getDate() + 280);
  const diff = new Date().getTime() - lmpDate.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const weeks = Math.floor(days / 7);
  const remainingDays = days % 7;
  return {
    lmp: dateStr,
    edd: eddDate.toISOString().slice(0, 10),
    pog: `${weeks} Weeks ${remainingDays} Days`,
  };
};

// --- SUB-MODULES ---

export const AdmissionNoteModule: React.FC<{
  activeAdmission: IpdAdmission;
  onUpdateAdmission: (data: Partial<IpdAdmission>) => void;
  visits: VisitRecord[];
  patient: Patient;
  setTemplateModal: any;
}> = ({
  activeAdmission,
  onUpdateAdmission,
  visits,
  patient,
  setTemplateModal,
}) => {
  const [form, setForm] = useState<IpdAdmissionNote>(
    activeAdmission.admissionNote || {
      id: "",
      date: activeAdmission.admissionDate,
      chiefComplaints: "",
      historyOfPresentIllness: "",
      pastHistory: "",
      obstetricHistory: "",
      menstrualHistory: "",
      generalExamination: "",
      systemicExamination: "",
      localExamination: "",
      provisionalDiagnosis: activeAdmission.diagnosis,
      planOfCare: "",
      bp: "",
      pulse: "",
      weight: "",
      spo2: "",
    },
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const { isRecording, start: startListening } = useAiVoiceInput(
    async (text) => {
      setIsProcessing(true);
      try {
        const draft = await generateAdmissionNote(text);
        setForm((prev) => ({ ...prev, ...(draft as any) }));
      } catch (e) {
        console.error(e);
      } finally {
        setIsProcessing(false);
      }
    },
  );

  const handleFetchFromOpd = () => {
    const patientVisits = visits
      .filter((v) => v.patientId === patient.id)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const lastVisit = patientVisits[0];

    if (lastVisit) {
      setForm((prev) => ({
        ...prev,
        bp: lastVisit.vitals?.bp || prev.bp,
        pulse: lastVisit.vitals?.pulse || prev.pulse,
        weight: lastVisit.vitals?.weight || prev.weight,
        spo2: lastVisit.vitals?.spo2 || prev.spo2,
        generalExamination: (
          prev.generalExamination +
          "\n" +
          (lastVisit.generalExamination || "")
        ).trim(),
        localExamination: (
          prev.localExamination +
          "\n" +
          (lastVisit.examinationDetails || "")
        ).trim(),
        chiefComplaints: (
          prev.chiefComplaints +
          "\n" +
          (lastVisit.complaints || "")
        ).trim(),
        obstetricHistory:
          lastVisit.visitObstetricHistory ||
          patient.obstetricHistory ||
          prev.obstetricHistory,
        menstrualHistory:
          (lastVisit.visitLmp ? `LMP: ${lastVisit.visitLmp} ` : "") +
            (lastVisit.visitEdd ? `EDD: ${lastVisit.visitEdd} ` : "") +
            (lastVisit.visitPog ? `POG: ${lastVisit.visitPog}` : "") ||
          prev.menstrualHistory,
      }));
      alert("Details fetched from last OPD visit.");
    } else {
      alert("No previous OPD visits found for this patient.");
    }
  };

  const handleAiDraft = async () => {
    setIsProcessing(true);
    try {
      // Check for Pregnant Patient LMP Calculation
      const isPregnant =
        patient.type === "obstetric" || patient.type === "gynecology"; // Assuming gynae might be relevant
      if (isPregnant && form.menstrualHistory) {
        // Try to find LMP in the text or input
        const lmpMatch = form.menstrualHistory.match(/\d{4}-\d{2}-\d{2}/);
        if (lmpMatch) {
          const calc = calculatePregnancy(lmpMatch[0]);
          const existingMH = form.menstrualHistory;
          if (!existingMH.includes("EDD")) {
            setForm((prev) => ({
              ...prev,
              menstrualHistory: `${existingMH} | EDD: ${calc.edd} | POG: ${calc.pog}`,
            }));
          }
        }
      }

      const clues = `
                Patient: ${patient.name}, Age: ${patient.age}, Type: ${patient.type}.
                Complaints: ${form.chiefComplaints}.
                Vitals: BP ${form.bp}, Pulse ${form.pulse}.
                History: ${form.obstetricHistory} ${form.pastHistory}.
                Examination clues: ${form.generalExamination} ${form.localExamination}.
                Diagnosis: ${form.provisionalDiagnosis}.
            `;
      const draft = await generateAdmissionNote(clues);
      setForm((prev) => ({ ...prev, ...(draft as any) }));
    } catch (e) {
      alert("AI Draft failed.");
    } finally {
      setIsProcessing(false);
    }
  };

  const saveNote = () => {
    onUpdateAdmission({
      admissionNote: { ...form, id: form.id || Date.now().toString() },
    });
    alert("Admission Note Saved");
  };

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`
            <html><head><title>Admission Note - ${patient.name}</title></head>
            <body style="font-family: sans-serif; padding: 20px;">
                <h2 style="text-align:center; text-transform:uppercase;">Admission Note</h2>
                <div style="display:flex; justify-content:space-between; border-bottom:1px solid #000; padding-bottom:10px; margin-bottom:10px;">
                    <div><strong>Patient:</strong> ${patient.name} (${patient.age})</div>
                    <div><strong>Date:</strong> ${new Date(form.date).toLocaleDateString()}</div>
                    <div><strong>UHID:</strong> ${patient.uhid || "-"}</div>
                </div>
                <p><strong>Chief Complaints:</strong> ${form.chiefComplaints}</p>
                <p><strong>HPI:</strong> ${form.historyOfPresentIllness}</p>
                <p><strong>Obs History:</strong> ${form.obstetricHistory}</p>
                <p><strong>Menstrual History:</strong> ${form.menstrualHistory}</p>
                <p><strong>Past History:</strong> ${form.pastHistory}</p>
                <p><strong>General Exam:</strong> BP: ${form.bp}, Pulse: ${form.pulse}, Wt: ${form.weight}, SpO2: ${form.spo2}</p>
                <p>${form.generalExamination}</p>
                <p><strong>Systemic Exam:</strong> ${form.systemicExamination}</p>
                <p><strong>Local Exam:</strong> ${form.localExamination}</p>
                <p><strong>Diagnosis:</strong> ${form.provisionalDiagnosis}</p>
                <p><strong>Plan:</strong> ${form.planOfCare}</p>
                <br/><br/>
                <div style="text-align:right;"><strong>Doctor's Signature</strong></div>
            </body></html>
        `);
    printWindow.document.close();
  };

  return (
    <div className="flex flex-col gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mb-6">
      <div className="flex justify-between items-center border-b border-slate-100 pb-4 mb-2">
        <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">
          Admission Note
        </h3>
        <div className="flex gap-2">
          <button
            onClick={handleFetchFromOpd}
            className="bg-blue-50 text-blue-700 px-4 py-2 rounded-xl text-xs font-black uppercase hover:bg-blue-100"
          >
            📥 Fetch OPD
          </button>
          <button
            onClick={() =>
              setTemplateModal({
                isOpen: true,
                mode: "load",
                type: "admission_note",
                onLoad: (content: string) => {
                  try {
                    const loaded = JSON.parse(content);
                    setForm(loaded);
                  } catch(e) {
                    setForm({...form, chiefComplaints: content});
                  }
                }
              })
            }
            className="bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-xs font-black uppercase"
          >
            📂 Load
          </button>
          <button
            onClick={() =>
              setTemplateModal({
                isOpen: true,
                mode: "save",
                type: "admission_note",
                payload: JSON.stringify(form)
              })
            }
            className="bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-xs font-black uppercase"
          >
            💾 Save
          </button>
          <button
            onClick={handlePrint}
            className="bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-black uppercase shadow-md"
          >
            🖨️ Print
          </button>
          <button
            onClick={handleAiDraft}
            disabled={isProcessing}
            className="bg-purple-100 text-purple-700 px-4 py-2 rounded-xl text-xs font-black uppercase hover:bg-purple-200"
          >
            ✨ AI Auto-Complete
          </button>
          <button
            onClick={startListening}
            disabled={isRecording}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-2 ${isRecording ? "bg-red-500 text-white animate-pulse" : "bg-slate-800 text-white"}`}
          >
            {isRecording ? "Listening..." : "🎙️ Voice Entry"}
          </button>
        </div>
      </div>

      {isProcessing && (
        <div className="text-center text-xs text-blue-600 font-bold animate-pulse">
          AI Generating...
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-4 grid grid-cols-4 gap-4 bg-slate-50 p-3 rounded-xl border border-slate-100">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">
              BP
            </label>
            <input
              value={form.bp}
              onChange={(e) => setForm({ ...form, bp: e.target.value })}
              className="w-full bg-transparent font-bold border-b border-slate-300 outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">
              Pulse
            </label>
            <input
              value={form.pulse}
              onChange={(e) => setForm({ ...form, pulse: e.target.value })}
              className="w-full bg-transparent font-bold border-b border-slate-300 outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">
              Weight
            </label>
            <input
              value={form.weight}
              onChange={(e) => setForm({ ...form, weight: e.target.value })}
              className="w-full bg-transparent font-bold border-b border-slate-300 outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">
              SpO2
            </label>
            <input
              value={form.spo2}
              onChange={(e) => setForm({ ...form, spo2: e.target.value })}
              className="w-full bg-transparent font-bold border-b border-slate-300 outline-none"
            />
          </div>
        </div>

        <div className="md:col-span-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Chief Complaints
          </label>
          <textarea
            value={form.chiefComplaints}
            onChange={(e) =>
              setForm({ ...form, chiefComplaints: e.target.value })
            }
            className="w-full border rounded p-2 text-sm h-24 font-medium"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            History of Present Illness
          </label>
          <textarea
            value={form.historyOfPresentIllness}
            onChange={(e) =>
              setForm({ ...form, historyOfPresentIllness: e.target.value })
            }
            className="w-full border rounded p-2 text-sm h-24"
          />
        </div>

        <div className="md:col-span-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Past History (Med/Surg)
          </label>
          <textarea
            value={form.pastHistory}
            onChange={(e) => setForm({ ...form, pastHistory: e.target.value })}
            className="w-full border rounded p-2 text-sm h-20"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Menstrual History (LMP/EDD)
          </label>
          <textarea
            value={form.menstrualHistory}
            onChange={(e) =>
              setForm({ ...form, menstrualHistory: e.target.value })
            }
            className="w-full border rounded p-2 text-sm h-20"
          />
        </div>

        <div className="md:col-span-4">
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Obstetric History (G_P_L_A_)
          </label>
          <input
            value={form.obstetricHistory}
            onChange={(e) =>
              setForm({ ...form, obstetricHistory: e.target.value })
            }
            className="w-full border rounded p-2 text-sm font-bold"
          />
        </div>

        <div className="md:col-span-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            General Examination
          </label>
          <textarea
            value={form.generalExamination}
            onChange={(e) =>
              setForm({ ...form, generalExamination: e.target.value })
            }
            className="w-full border rounded p-2 text-sm h-24"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Systemic Examination (CVS/RS/PA)
          </label>
          <textarea
            value={form.systemicExamination}
            onChange={(e) =>
              setForm({ ...form, systemicExamination: e.target.value })
            }
            className="w-full border rounded p-2 text-sm h-24"
          />
        </div>

        <div className="md:col-span-4">
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Local Examination (PV/PS)
          </label>
          <textarea
            value={form.localExamination}
            onChange={(e) =>
              setForm({ ...form, localExamination: e.target.value })
            }
            className="w-full border rounded p-2 text-sm h-20"
          />
        </div>

        <div className="md:col-span-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Provisional Diagnosis
          </label>
          <input
            value={form.provisionalDiagnosis}
            onChange={(e) =>
              setForm({ ...form, provisionalDiagnosis: e.target.value })
            }
            className="w-full border rounded p-2 text-sm font-bold text-blue-800"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Plan of Care
          </label>
          <input
            value={form.planOfCare}
            onChange={(e) => setForm({ ...form, planOfCare: e.target.value })}
            className="w-full border rounded p-2 text-sm font-bold"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={saveNote}
          className="flex-grow bg-slate-900 text-white py-3 rounded-xl font-black uppercase text-xs tracking-widest mt-2 hover:bg-black transition-all"
        >
          Save Admission Note
        </button>
      </div>
    </div>
  );
};

export const WardConsentModule: React.FC<{
  activeAdmission: IpdAdmission;
  onUpdateAdmission: (d: Partial<IpdAdmission>) => void;
  clinicalTemplates: ClinicalTemplate[];
  onUpdateTemplates: (t: ClinicalTemplate[]) => void;
  patient: Patient;
}> = ({
  activeAdmission,
  onUpdateAdmission,
  clinicalTemplates,
  onUpdateTemplates,
  patient,
}) => {
  const [view, setView] = useState<"list" | "add" | "create">("list");
  const [newConsentTitle, setNewConsentTitle] = useState("");
  const [newConsentContent, setNewConsentContent] = useState("");

  const patientConsents = activeAdmission.consents || [];
  const consentTemplates = clinicalTemplates.filter(
    (t) => t.category === "consent",
  );

  const handlePrint = (title: string, content: string) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const printContent = content
      .replace(/{{PATIENT}}/g, patient.name)
      .replace(/{{DOCTOR}}/g, activeAdmission.primaryDoctor);
    printWindow.document
      .write(`<html><head><title>${title}</title></head><body style="padding: 40px; font-family: sans-serif;">
            <h1 style="text-align: center; text-transform: uppercase;">${title}</h1>
            <p><strong>Patient:</strong> ${patient.name} | <strong>Age:</strong> ${patient.age}</p>
            <hr/>
            <div style="white-space: pre-wrap; line-height: 1.6; margin-top: 20px;">${printContent}</div>
            <div style="margin-top: 50px; display: flex; justify-content: space-between;">
                <div>___________________<br/>Signature of Patient</div>
                <div>___________________<br/>Signature of Witness</div>
                <div>___________________<br/>Doctor's Signature</div>
            </div>
            <script>window.print();</script>
        </body></html>`);
    printWindow.document.close();
  };

  const addConsentFromTemplate = (t: ClinicalTemplate) => {
    const consent: PatientConsent = {
      id: Date.now().toString(),
      templateId: t.id,
      title: t.title,
      content: t.content,
      dateAdded: new Date().toISOString(),
    };
    onUpdateAdmission({ consents: [...patientConsents, consent] });
    setView("list");
  };

  const saveCreatedConsent = () => {
    if (!newConsentTitle || !newConsentContent) {
      alert("Title and content required");
      return;
    }
    const consent: PatientConsent = {
      id: Date.now().toString(),
      title: newConsentTitle,
      content: newConsentContent,
      dateAdded: new Date().toISOString(),
    };
    onUpdateAdmission({ consents: [...patientConsents, consent] });
    setView("list");
  };

  const saveCreatedConsentAsTemplate = () => {
    if (!newConsentTitle || !newConsentContent) {
      alert("Title and content required");
      return;
    }
    const newTemplate: ClinicalTemplate = {
      id: "T" + Date.now().toString(),
      title: newConsentTitle,
      category: "consent",
      content: newConsentContent,
    };
    onUpdateTemplates([...clinicalTemplates, newTemplate]);
    alert("Saved to Templates!");
  };

  const { isRecording, start: startVoice } = useAiVoiceInput((text) =>
    setNewConsentContent(text),
  );
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAiGenerate = async () => {
    const prompt = window.prompt(
      "What should this consent be for? (e.g., 'C-Section', 'Blood Transfusion')",
    );
    if (!prompt) return;
    setIsProcessing(true);
    try {
      const result = await generateConsent(prompt);
      setNewConsentTitle(`${prompt} Consent (Draft)`);
      setNewConsentContent(result);
    } catch (error) {
      alert("Failed to generate consent.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTranslate = async () => {
    if (!newConsentContent) {
      alert("No content to translate.");
      return;
    }
    const lang = window.prompt(
      "Language to translate to? (e.g., 'Hindi', 'Gujarati', 'Marathi')",
    );
    if (!lang) return;
    setIsProcessing(true);
    try {
      const result = await translateText(newConsentContent, lang);
      setNewConsentContent(result);
    } catch (error) {
      alert("Failed to translate.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 mt-6 shadow-sm">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">
          {view === "list"
            ? "Patient Consents"
            : view === "add"
              ? "Add Consent attached to Patient"
              : "Create New Consent"}
        </h3>
        {view === "list" && (
          <button
            onClick={() => setView("add")}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase shadow-md hover:bg-blue-700"
          >
            + Add Consent
          </button>
        )}
        {view !== "list" && (
          <button
            onClick={() => setView("list")}
            className="text-slate-500 text-xs font-bold uppercase hover:text-slate-700"
          >
            Back to List
          </button>
        )}
      </div>

      {view === "list" && (
        <div className="space-y-4">
          {patientConsents.length === 0 ? (
            <p className="text-slate-400 italic text-sm text-center py-8">
              No consents added for this patient yet.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {patientConsents.map((c) => (
                <div
                  key={c.id}
                  className="p-4 bg-slate-50 rounded-xl border border-slate-200"
                >
                  <div className="flex justify-between items-start mb-2">
                    <p className="font-bold text-slate-700 leading-tight">
                      {c.title}
                    </p>
                    <button
                      onClick={() => {
                        if (confirm("Remove this consent?"))
                          onUpdateAdmission({
                            consents: patientConsents.filter(
                              (x) => x.id !== c.id,
                            ),
                          });
                      }}
                      className="text-red-400 hover:text-red-600 font-bold text-lg"
                    >
                      &times;
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 uppercase mb-4">
                    Added: {new Date(c.dateAdded).toLocaleDateString()}
                  </p>
                  <button
                    onClick={() => handlePrint(c.title, c.content)}
                    className="w-full bg-slate-200 text-slate-700 py-2 rounded-lg text-xs font-bold uppercase hover:bg-slate-300"
                  >
                    🖨️ Print
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === "add" && (
        <div className="space-y-6">
          <div className="border border-blue-200 bg-blue-50 p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="font-black text-blue-800 text-sm">
                Cannot find the consent you need?
              </p>
              <p className="text-xs text-blue-600">
                You can type, dictate, or upload a new consent.
              </p>
            </div>
            <button
              onClick={() => {
                setNewConsentTitle("");
                setNewConsentContent("");
                setView("create");
              }}
              className="bg-white text-blue-600 border border-blue-200 px-4 py-2 rounded-lg text-xs font-black uppercase shadow-sm"
            >
              Create New
            </button>
          </div>
          <div>
            <h4 className="font-bold text-sm text-slate-600 uppercase mb-3 border-b pb-2">
              Select from Templates
            </h4>
            {consentTemplates.length === 0 ? (
              <p className="text-slate-400 italic text-sm">
                No templates available.
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {consentTemplates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => addConsentFromTemplate(t)}
                    className="p-4 bg-white rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50 text-left transition-all"
                  >
                    <p className="font-bold text-slate-700">{t.title}</p>
                    <p className="text-[10px] text-blue-500 uppercase mt-2 font-bold">
                      + Add to Patient
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {view === "create" && (
        <div className="space-y-4 relative">
          {isProcessing && (
            <div className="absolute inset-0 bg-white/70 flex justify-center items-center font-bold text-blue-600 z-10">
              Processing AI...
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={startVoice}
              className={`px-4 py-2 rounded-lg text-xs font-black uppercase shadow-sm flex items-center gap-2 ${isRecording ? "bg-red-500 text-white animate-pulse" : "bg-slate-100 text-slate-700"}`}
            >
              🎙️ Dictate
            </button>
            <button
              onClick={handleAiGenerate}
              className="bg-purple-100 text-purple-700 border border-purple-200 px-4 py-2 rounded-lg text-xs font-black uppercase shadow-sm"
            >
              ✨ Generate with AI
            </button>
            <button
              onClick={handleTranslate}
              className="bg-green-100 text-green-700 border border-green-200 px-4 py-2 rounded-lg text-xs font-black uppercase shadow-sm"
            >
              🌐 Translate Content
            </button>
          </div>
          <input
            autoFocus
            placeholder="Consent Title (e.g. High Risk Consent)"
            value={newConsentTitle}
            onChange={(e) => setNewConsentTitle(e.target.value)}
            className="w-full border border-slate-200 rounded-xl p-3 font-bold text-sm"
          />
          <textarea
            placeholder="Consent Content... You can use {{PATIENT}} and {{DOCTOR}} placeholders."
            value={newConsentContent}
            onChange={(e) => setNewConsentContent(e.target.value)}
            className="w-full border border-slate-200 rounded-xl p-3 font-medium text-sm h-64 resize-y"
          />
          <div className="flex gap-2">
            <button
              onClick={saveCreatedConsent}
              className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold text-xs uppercase shadow flex-1"
            >
              Save to Patient
            </button>
            <button
              onClick={saveCreatedConsentAsTemplate}
              className="bg-slate-800 text-white px-6 py-3 rounded-xl font-bold text-xs uppercase shadow flex-1"
            >
              Save as Template
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const DailyRoundsModule: React.FC<{
  activeAdmission: IpdAdmission;
  onUpdateAdmission: (data: Partial<IpdAdmission>) => void;
  setTemplateModal: any;
  clinicalTemplates?: ClinicalTemplate[];
  consultants: Consultant[];
}> = ({
  activeAdmission,
  onUpdateAdmission,
  setTemplateModal,
  clinicalTemplates,
  consultants,
}) => {
  // ... (Existing implementation)
  const [roundData, setRoundData] = useState({
    timestamp: new Date().toISOString().slice(0, 16),
    doctorName: activeAdmission.primaryDoctor,
    gc: "Fair",
    pulse: "",
    bp: "",
    cvs: "Normal",
    rs: "Normal",
    physicalExamination: "",
    medication: "",
    investigation: "",
    advice: "",
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);

  // Voice & AI Logic
  const processAiDraft = async (text: string) => {
    setIsAiProcessing(true);
    try {
      const extracted = await parseDailyRoundNote(text);
      setRoundData((prev) => ({ ...prev, ...extracted }));
    } catch (e) {
      alert("AI processing failed.");
    } finally {
      setIsAiProcessing(false);
    }
  };

  const { isRecording, start: startVoice } = useAiVoiceInput((text) =>
    processAiDraft(text),
  );

  const handleSaveRound = () => {
    let updatedRounds = activeAdmission.roundNotes || [];
    const noteData: IpdRoundNote = {
      id: editingId || Date.now().toString(),
      timestamp: roundData.timestamp,
      doctorName: roundData.doctorName,
      gc: roundData.gc,
      pulse: roundData.pulse,
      bp: roundData.bp,
      cvs: roundData.cvs,
      rs: roundData.rs,
      physicalExamination: roundData.physicalExamination,
      medication: roundData.medication,
      investigation: roundData.investigation,
      advice: roundData.advice,
      note: `${roundData.gc}, BP:${roundData.bp}, Pulse:${roundData.pulse}. ${roundData.physicalExamination}`,
      vitals: {
        bp: roundData.bp,
        pulse: roundData.pulse,
        weight: "",
        height: "",
        spo2: "",
      },
    };
    if (editingId) {
      updatedRounds = updatedRounds.map((r) =>
        r.id === editingId ? noteData : r,
      );
      setEditingId(null);
    } else {
      updatedRounds = [noteData, ...updatedRounds];
    }
    onUpdateAdmission({ roundNotes: updatedRounds });
    setRoundData({
      timestamp: new Date().toISOString().slice(0, 16),
      doctorName: activeAdmission.primaryDoctor,
      gc: "Fair",
      pulse: "",
      bp: "",
      cvs: "Normal",
      rs: "Normal",
      physicalExamination: "",
      medication: "",
      investigation: "",
      advice: "",
    });
  };

  const handleEditRound = (round: IpdRoundNote) => {
    setRoundData({
      timestamp: round.timestamp || new Date().toISOString().slice(0, 16),
      doctorName: round.doctorName || activeAdmission.primaryDoctor,
      gc: round.gc || "Fair",
      pulse: round.pulse || round.vitals?.pulse || "",
      bp: round.bp || round.vitals?.bp || "",
      cvs: round.cvs || "Normal",
      rs: round.rs || "Normal",
      physicalExamination: round.physicalExamination || round.note || "",
      medication: round.medication || "",
      investigation: round.investigation || "",
      advice: round.advice || "",
    });
    setEditingId(round.id);
    document
      .getElementById("rounds-form")
      ?.scrollIntoView({ behavior: "smooth" });
  };

  const handleDeleteRound = (id: string) => {
    if (confirm("Are you sure you want to delete this round note?")) {
      const updated = activeAdmission.roundNotes.filter((r) => r.id !== id);
      onUpdateAdmission({ roundNotes: updated });
    }
  };

  const handleScanMonitor = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setIsScanning(true);
    try {
      const file = e.target.files[0];
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) =>
          resolve((ev.target?.result as string).split(",")[1]);
        reader.readAsDataURL(file);
      });
      const vitals = await extractVitalsFromImage(base64, file.type);
      setRoundData((prev) => ({
        ...prev,
        bp: vitals.bpSystolic
          ? `${vitals.bpSystolic}/${vitals.bpDiastolic}`
          : prev.bp,
        pulse: vitals.pulse || prev.pulse,
      }));
      alert("Vitals extracted from monitor!");
    } catch (error) {
      alert("Failed to scan monitor.");
    } finally {
      setIsScanning(false);
    }
  };

  const handlePrintAll = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const sortedNotes = [...activeAdmission.roundNotes].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    const notesHtml = sortedNotes
      .map(
        (note) => `
            <div class="note-container">
                <div class="col-1">
                    <p><strong>Date/Time:</strong><br>${new Date(note.timestamp).toLocaleString()}</p>
                    ${note.investigation ? `<p style="margin-top:10px;"><strong>Inv Advised:</strong><br>${note.investigation.replace(/\n/g, "<br>")}</p>` : ""}
                </div>
                <div class="col-2">
                    <div class="seen-by">Seen by ${note.doctorName}</div>
                    <div class="exam-grid">
                        <span><strong>GC:</strong> ${note.gc}</span>
                        <span><strong>Pulse:</strong> ${note.pulse}</span>
                        <span><strong>BP:</strong> ${note.bp}</span>
                        <span><strong>CVS:</strong> ${note.cvs}</span>
                        <span><strong>RS:</strong> ${note.rs}</span>
                    </div>
                    <p style="margin-top:5px;"><strong>Physical Exam:</strong><br>${note.physicalExamination?.replace(/\n/g, "<br>") || "-"}</p>
                </div>
                <div class="col-3">
                    <p><strong>Advice:</strong><br>${note.advice?.replace(/\n/g, "<br>") || "-"}</p>
                    ${note.medication ? `<div class="rx-section"><strong>Rx (Medication):</strong><br>${note.medication.replace(/\n/g, "<br>")}</div>` : ""}
                </div>
            </div>
        `,
      )
      .join("");
    printWindow.document.write(
      `<html><head><title>Doctor Round Notes</title><style>@page { size: A4; margin: 10mm; } body { font-family: sans-serif; font-size: 12px; } h2 { text-align: center; text-transform: uppercase; border-bottom: 2px solid black; padding-bottom: 5px; } .note-container { display: flex; border-bottom: 1px solid #ccc; padding: 10px 0; page-break-inside: avoid; } .col-1 { width: 15%; padding-right: 10px; border-right: 1px solid #eee; font-size: 11px; } .col-2 { width: 45%; padding: 0 10px; border-right: 1px solid #eee; } .col-3 { width: 40%; padding-left: 10px; } .seen-by { font-weight: bold; text-transform: uppercase; margin-bottom: 5px; color: #444; } .exam-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; font-size: 11px; margin-bottom: 5px; } .rx-section { margin-top: 10px; font-weight: bold; }</style></head><body><h2>Doctor Round Notes</h2><p><strong>Patient:</strong> ${activeAdmission.patientId} (ID: ${activeAdmission.id})</p>${notesHtml}<script>window.onload = () => { window.print(); window.close(); }</script></body></html>`,
    );
    printWindow.document.close();
  };

  const TemplateBtn = ({
    type,
    targetField,
  }: {
    type: ClinicalTemplate["category"];
    targetField: keyof typeof roundData;
  }) => (
    <div className="flex gap-1 mt-1">
      <button
        onClick={() =>
          setTemplateModal({
            isOpen: true,
            mode: "save",
            type: type,
            payload: roundData[targetField],
          })
        }
        className="text-[9px] bg-slate-100 px-2 py-1 rounded hover:bg-slate-200 text-slate-600 uppercase font-bold"
      >
        Save Tmpl
      </button>
      <button
        onClick={() =>
          setTemplateModal({ isOpen: true, mode: "load", type: type })
        }
        className="text-[9px] bg-blue-50 px-2 py-1 rounded hover:bg-blue-100 text-blue-600 uppercase font-bold"
      >
        Load Tmpl
      </button>
    </div>
  );

  return (
    <div
      className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4"
      id="rounds-form"
    >
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">
          Doctor Round Notes
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => {
              const text = prompt(
                "Paste text, or type 'Post LSCS' for automated entry:",
              );
              if (text) processAiDraft(text);
            }}
            className="bg-purple-100 text-purple-700 px-3 py-2 rounded-lg text-xs font-black uppercase flex items-center gap-2 border border-purple-200 hover:bg-purple-200"
          >
            {isAiProcessing ? "...Processing" : "✨ AI Auto-Complete"}
          </button>
          <button
            onClick={startVoice}
            className={`px-3 py-2 rounded-lg text-xs font-black uppercase flex items-center gap-2 ${isRecording ? "bg-red-500 text-white animate-pulse" : "bg-slate-100 text-slate-700"}`}
          >
            🎙️ Voice
          </button>
          <label className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-2 rounded-lg text-xs font-black uppercase cursor-pointer">
            {isScanning ? "Scanning..." : "📸 Monitor"}
            <input
              type="file"
              className="hidden"
              accept="image/*"
              onChange={handleScanMonitor}
              disabled={isScanning}
            />
          </label>
          <button
            onClick={handlePrintAll}
            className="bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-slate-900 transition-all shadow-md"
          >
            🖨️ Print
          </button>
        </div>
      </div>

      <div className="flex gap-2 bg-slate-50 p-2 rounded-lg mb-2">
        <span className="text-xs font-bold text-slate-500 self-center">
          Whole Note:
        </span>
        <button
          onClick={() =>
            setTemplateModal({
              isOpen: true,
              mode: "save",
              type: "ipd_round",
              payload: JSON.stringify(roundData),
            })
          }
          className="bg-white border px-3 py-1 rounded text-xs font-bold hover:bg-slate-100"
        >
          Save as Template
        </button>
        <button
          onClick={() =>
            setTemplateModal({ 
              isOpen: true, 
              mode: "load", 
              type: "ipd_round",
              onLoad: (content: string) => {
                try {
                   const loaded = JSON.parse(content);
                   setRoundData({...roundData, ...loaded, timestamp: new Date().toISOString().slice(0, 16)});
                } catch(e) {
                   console.error("Invalid template format", e);
                }
              }
            })
          }
          className="bg-white border px-3 py-1 rounded text-xs font-bold hover:bg-slate-100"
        >
          Load Template
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
        <div className="lg:col-span-2 space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
              Date & Time
            </label>
            <input
              type="datetime-local"
              value={roundData.timestamp}
              onChange={(e) =>
                setRoundData({ ...roundData, timestamp: e.target.value })
              }
              className="w-full border border-slate-300 rounded-lg px-2 py-2 text-xs font-bold bg-white"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
              Doctor Name
            </label>
            <input
              list="doctors"
              value={roundData.doctorName}
              onChange={(e) =>
                setRoundData({ ...roundData, doctorName: e.target.value })
              }
              className="w-full border border-slate-300 rounded-lg px-2 py-2 text-xs font-bold bg-white"
              placeholder="Select/Type Doctor"
            />
            <datalist id="doctors">
              {consultants.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="lg:col-span-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                GC
              </label>
              <select
                value={roundData.gc}
                onChange={(e) =>
                  setRoundData({ ...roundData, gc: e.target.value })
                }
                className="w-full border rounded-lg px-2 py-2 text-xs font-bold bg-white"
              >
                <option value="Fair">Fair</option>
                <option value="Moderate">Moderate</option>
                <option value="Poor">Poor</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                Pulse / BP
              </label>
              <div className="flex gap-1">
                <input
                  placeholder="PR"
                  value={roundData.pulse}
                  onChange={(e) =>
                    setRoundData({ ...roundData, pulse: e.target.value })
                  }
                  className="w-1/2 border rounded px-2 py-2 text-xs"
                />
                <input
                  placeholder="BP"
                  value={roundData.bp}
                  onChange={(e) =>
                    setRoundData({ ...roundData, bp: e.target.value })
                  }
                  className="w-1/2 border rounded px-2 py-2 text-xs"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                CVS
              </label>
              <select
                value={roundData.cvs}
                onChange={(e) =>
                  setRoundData({ ...roundData, cvs: e.target.value })
                }
                className="w-full border rounded-lg px-2 py-2 text-xs font-bold bg-white"
              >
                <option value="Normal">Normal</option>
                <option value="S1S2 heard">S1S2 heard</option>
                <option value="Murmur present">Murmur present</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                RS
              </label>
              <select
                value={roundData.rs}
                onChange={(e) =>
                  setRoundData({ ...roundData, rs: e.target.value })
                }
                className="w-full border rounded-lg px-2 py-2 text-xs font-bold bg-white"
              >
                <option value="Normal">Normal</option>
                <option value="Bilateral air entry equal">AE Equal</option>
                <option value="Crepts present">Crepts +</option>
                <option value="Wheeze present">Wheeze +</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
              Physical Examination
            </label>
            <textarea
              value={roundData.physicalExamination}
              onChange={(e) =>
                setRoundData({
                  ...roundData,
                  physicalExamination: e.target.value,
                })
              }
              className="w-full border border-slate-300 rounded-lg p-2 text-xs font-medium h-24 bg-white resize-none"
              placeholder="P/A, Local Exam, etc..."
            />
            <TemplateBtn type="phys_exam" targetField="physicalExamination" />
          </div>
        </div>
        <div className="lg:col-span-5 space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
              Medication (Rx)
            </label>
            <textarea
              value={roundData.medication}
              onChange={(e) =>
                setRoundData({ ...roundData, medication: e.target.value })
              }
              className="w-full border border-slate-300 rounded-lg p-2 text-xs font-medium h-32 bg-white resize-none"
              placeholder="Prescriptions..."
            />
            <TemplateBtn type="round_rx" targetField="medication" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
              Doctor's Advice
            </label>
            <textarea
              value={roundData.advice}
              onChange={(e) =>
                setRoundData({ ...roundData, advice: e.target.value })
              }
              className="w-full border border-slate-300 rounded-lg p-2 text-xs font-medium h-20 bg-white resize-none mb-4"
              placeholder="Rest, Diet, etc..."
            />
            <TemplateBtn type="round_advice" targetField="advice" />
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
             <label className="block text-[10px] font-bold text-slate-400 uppercase mb-3 border-b pb-2">
               Inv. Advised
             </label>
             <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                 {['CBC', 'Serology', 'Urine', 'CRP', 'Blood Sugar', 'Blood Group', 'Widal', 'Semen', 'USG'].map((test) => {
                     const isSelected = roundData.investigation.split(',').map(s=>s.trim()).includes(test);
                     return (
                         <label key={test} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-slate-100 rounded">
                             <input 
                                 type="checkbox" 
                                 checked={isSelected}
                                 onChange={() => {
                                     let list = roundData.investigation.split(',').map(s=>s.trim()).filter(t => t !== '');
                                     if (isSelected) {
                                         list = list.filter(t => t !== test);
                                     } else {
                                         list.push(test);
                                     }
                                     setRoundData({ ...roundData, investigation: list.join(', ') });
                                 }}
                                 className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500 border-gray-300"
                             />
                             <span className="text-[10px] font-black uppercase text-slate-700">{test}</span>
                         </label>
                     );
                 })}
             </div>
             <TemplateBtn type="round_investigation" targetField="investigation" />
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-3">
        {editingId && (
          <button
            onClick={() => {
              setEditingId(null);
              setRoundData({
                timestamp: new Date().toISOString().slice(0, 16),
                doctorName: activeAdmission.primaryDoctor,
                gc: "Fair",
                pulse: "",
                bp: "",
                cvs: "Normal",
                rs: "Normal",
                physicalExamination: "",
                medication: "",
                investigation: "",
                advice: "",
              });
            }}
            className="px-6 py-2 rounded-lg bg-slate-200 text-slate-700 font-bold text-xs uppercase"
          >
            Cancel Edit
          </button>
        )}
        <button
          onClick={handleSaveRound}
          className="px-8 py-3 rounded-xl bg-blue-600 text-white font-black text-xs uppercase tracking-widest shadow-lg hover:bg-blue-700 transition-all"
        >
          {editingId ? "Update Round Note" : "Add Round Note"}
        </button>
      </div>
      <div className="space-y-3 mt-6 border-t pt-6">
        <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">
          History Log
        </h4>
        {activeAdmission.roundNotes.map((r) => (
          <div
            key={r.id}
            onClick={() => handleEditRound(r)}
            className="bg-slate-50 p-4 rounded-xl border border-slate-200 relative group cursor-pointer hover:bg-blue-50 transition-colors"
          >
            <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteRound(r.id);
                }}
                className="text-red-500 hover:bg-red-100 p-1 rounded text-xs font-bold uppercase"
              >
                Delete
              </button>
            </div>
            <div className="flex justify-between text-xs font-bold text-slate-500 mb-2">
              <span>{new Date(r.timestamp).toLocaleString()}</span>
              <span>{r.doctorName}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="border-r pr-2">
                <p className="font-bold text-slate-700">Exam Summary:</p>
                <p>
                  GC: {r.gc}, BP: {r.bp}
                </p>
                <p>
                  CVS: {r.cvs}, RS: {r.rs}
                </p>
              </div>
              <div className="border-r pr-2">
                <p className="font-bold text-slate-700">Rx:</p>
                <p className="truncate text-slate-600">{r.medication || "-"}</p>
              </div>
              <div>
                <p className="font-bold text-slate-700">Advice/Inv:</p>
                <p className="truncate text-slate-600">
                  {r.advice} {r.investigation ? `+ ${r.investigation}` : ""}
                </p>
              </div>
            </div>
          </div>
        ))}
        {activeAdmission.roundNotes.length === 0 && (
          <p className="text-center text-slate-400 italic text-sm py-4">
            No round notes recorded.
          </p>
        )}
      </div>
    </div>
  );
};

export const NursingStationModule: React.FC<{
  activeAdmission: IpdAdmission;
  onUpdateAdmission: (data: Partial<IpdAdmission>) => void;
  setTemplateModal: any;
}> = ({ activeAdmission, onUpdateAdmission, setTemplateModal }) => {
  const [fluidEntry, setFluidEntry] = useState<Partial<FluidEntry>>({
    type: "intake",
    fluidName: "",
    amountMl: 0,
    route: "IV",
  });
  const [nursingNote, setNursingNote] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);

  const processAiDraft = async (text: string) => {
    setIsAiProcessing(true);
    try {
      const expanded = await expandNursingNote(text);
      setNursingNote(expanded);
    } catch (e) {
      alert("AI processing failed.");
    } finally {
      setIsAiProcessing(false);
    }
  };
  const { isRecording, start: startVoice } = useAiVoiceInput((text) =>
    processAiDraft(text),
  );

  const [medEntry, setMedEntry] = useState<{
    name: string;
    freq: string;
    route: string;
    time: string;
    sign: string;
  }>({
    name: "",
    freq: "BD",
    route: "IV",
    time: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    sign: "Nurse",
  });
  const [medStaging, setMedStaging] = useState<IpdMedicationChartEntry[]>([]);

  const handleAddFluid = () => {
    if (!fluidEntry.fluidName || !fluidEntry.amountMl) return;
    const newEntry: FluidEntry = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      type: fluidEntry.type as "intake" | "output",
      fluidName: fluidEntry.fluidName,
      amountMl: fluidEntry.amountMl,
      route: fluidEntry.route || "IV",
    };
    const updated = [...(activeAdmission.fluidBalance || []), newEntry];
    onUpdateAdmission({ fluidBalance: updated });
    setFluidEntry({ type: "intake", fluidName: "", amountMl: 0, route: "IV" });
  };

  const handleAddNursingNote = () => {
    if (!nursingNote.trim()) return;
    if (editingNoteId) {
      const updated = activeAdmission.nursingNotes.map((n) =>
        n.id === editingNoteId ? { ...n, note: nursingNote } : n,
      );
      onUpdateAdmission({ nursingNotes: updated });
      setEditingNoteId(null);
    } else {
      const note: NursingNote = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        note: nursingNote,
        nurseName: "Staff Nurse",
        complaints: "",
        generalCondition: "",
        perAbdomen: "",
        perVaginum: "",
        treatmentPlan: "",
        intakeIv: 0,
        intakeOral: 0,
        outputUrine: 0,
        outputOther: 0,
      };
      onUpdateAdmission({
        nursingNotes: [...(activeAdmission.nursingNotes || []), note],
      });
    }
    setNursingNote("");
  };

  const editNote = (note: NursingNote) => {
    setNursingNote(note.note);
    setEditingNoteId(note.id);
  };

  const handleScanMonitor = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setIsScanning(true);
    try {
      const file = e.target.files[0];
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) =>
          resolve((ev.target?.result as string).split(",")[1]);
        reader.readAsDataURL(file);
      });
      const vitals = await extractVitalsFromImage(base64, file.type);
      const noteText = `Auto-Vitals: BP ${vitals.bpSystolic}/${vitals.bpDiastolic}, Pulse ${vitals.pulse}, SpO2 ${vitals.spo2}%`;
      setNursingNote((prev) => (prev ? prev + "\n" + noteText : noteText));
      alert("Vitals captured!");
    } catch (error) {
      alert("Failed to scan monitor.");
    } finally {
      setIsScanning(false);
    }
  };

  const addToMedStaging = () => {
    if (!medEntry.name) return;
    const newEntry: IpdMedicationChartEntry = {
      id: Date.now().toString(),
      date: new Date().toISOString().slice(0, 10),
      nameOfMedication: medEntry.name,
      frequency: medEntry.freq,
      route: medEntry.route,
      morningTime: medEntry.time,
      morningSign: medEntry.sign,
    };
    setMedStaging([...medStaging, newEntry]);
    setMedEntry({ ...medEntry, name: "" });
  };

  const handlePhotoMed = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setIsScanning(true);
    try {
      const file = e.target.files[0];
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) =>
          resolve((ev.target?.result as string).split(",")[1]);
        reader.readAsDataURL(file);
      });
      const entries = await extractMedicationChartFromImage(base64, file.type);
      const newStagedItems = entries.map((item) => ({
        id: Date.now() + Math.random().toString(),
        date: item.date || new Date().toISOString().slice(0, 10),
        nameOfMedication: item.nameOfMedication || "Unknown",
        frequency: item.frequency || "",
        route: item.route || "",
        morningTime: item.morningTime || "",
        morningSign: "",
      }));
      setMedStaging((prev) => [...prev, ...newStagedItems]);
      alert(`Found ${newStagedItems.length} entries.`);
    } catch (error) {
      alert("Failed to extract.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleVoiceMed = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setMedEntry({ ...medEntry, name: transcript });
    };
    recognition.start();
  };

  const commitMedications = () => {
    if (medStaging.length === 0) return;
    const updated = [
      ...(activeAdmission.nursingMedicationCharts || []),
      ...medStaging,
    ];
    onUpdateAdmission({ nursingMedicationCharts: updated });
    setMedStaging([]);
    alert("Medications added to chart.");
  };

  const printMeds = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const rows = (activeAdmission.nursingMedicationCharts || [])
      .map(
        (m) =>
          `<tr><td>${m.date}</td><td>${m.nameOfMedication}</td><td>${m.frequency}</td><td>${m.route}</td><td>${m.morningTime}</td><td>${m.morningSign}</td></tr>`,
      )
      .join("");
    printWindow.document.write(
      `<html><head><title>Medication Chart</title><style>table { width: 100%; border-collapse: collapse; } td, th { border: 1px solid black; padding: 5px; font-size: 12px; } </style></head><body><h2>Medication Administration Record</h2><table><thead><tr><th>Date</th><th>Drug</th><th>Freq</th><th>Route</th><th>Time</th><th>Sign</th></tr></thead><tbody>${rows}</tbody></table><script>window.print();</script></body></html>`,
    );
    printWindow.document.close();
  };

  const printIO = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const rows = (activeAdmission.fluidBalance || [])
      .map(
        (f) =>
          `<tr><td>${new Date(f.timestamp).toLocaleString()}</td><td>${f.type}</td><td>${f.fluidName}</td><td>${f.amountMl} ml</td><td>${f.route}</td></tr>`,
      )
      .join("");
    printWindow.document.write(
      `<html><head><title>Intake/Output Chart</title><style>table { width: 100%; border-collapse: collapse; } td, th { border: 1px solid black; padding: 5px; font-size: 12px; } </style></head><body><h2>Fluid Balance Chart</h2><table><thead><tr><th>Time</th><th>Type</th><th>Fluid</th><th>Amount</th><th>Route</th></tr></thead><tbody>${rows}</tbody></table><script>window.print();</script></body></html>`,
    );
    printWindow.document.close();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">
            Vitals & Fluid Balance
          </h3>
          <div className="flex gap-2">
            <button
              onClick={printIO}
              className="bg-slate-200 text-slate-700 px-3 py-1 rounded text-xs font-bold uppercase"
            >
              🖨️ Print I/O
            </button>
            <label className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1 rounded-lg text-xs font-black uppercase cursor-pointer">
              {isScanning ? "Scanning..." : "📸 Scan Monitor"}
              <input
                type="file"
                className="hidden"
                accept="image/*"
                onChange={handleScanMonitor}
                disabled={isScanning}
              />
            </label>
          </div>
        </div>
        <div className="flex gap-4 items-end mb-4 flex-wrap">
          <select
            value={fluidEntry.type}
            onChange={(e) =>
              setFluidEntry({ ...fluidEntry, type: e.target.value as any })
            }
            className="border p-2 rounded-lg font-bold text-sm"
          >
            <option value="intake">Intake</option>
            <option value="output">Output</option>
          </select>
          <input
            placeholder="Fluid Name (e.g. NS, Urine)"
            value={fluidEntry.fluidName}
            onChange={(e) =>
              setFluidEntry({ ...fluidEntry, fluidName: e.target.value })
            }
            className="border p-2 rounded-lg font-bold text-sm flex-grow"
          />
          <input
            type="number"
            placeholder="ml"
            value={fluidEntry.amountMl || ""}
            onChange={(e) =>
              setFluidEntry({ ...fluidEntry, amountMl: Number(e.target.value) })
            }
            className="border p-2 rounded-lg font-bold text-sm w-20"
          />
          <select
            value={fluidEntry.route}
            onChange={(e) =>
              setFluidEntry({ ...fluidEntry, route: e.target.value })
            }
            className="border p-2 rounded-lg font-bold text-sm"
          >
            <option value="IV">IV</option>
            <option value="Oral">Oral</option>
            <option value="Catheter">Catheter</option>
          </select>
          <button
            onClick={handleAddFluid}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-xs uppercase"
          >
            Add
          </button>
        </div>
        <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 font-bold text-slate-500 uppercase">
              <tr>
                <th className="p-2">Time</th>
                <th className="p-2">Type</th>
                <th className="p-2">Fluid</th>
                <th className="p-2">Amount</th>
                <th className="p-2">Route</th>
              </tr>
            </thead>
            <tbody>
              {(activeAdmission.fluidBalance || []).map((f) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="p-2">
                    {new Date(f.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="p-2 font-bold uppercase">{f.type}</td>
                  <td className="p-2">{f.fluidName}</td>
                  <td className="p-2 font-bold">{f.amountMl} ml</td>
                  <td className="p-2">{f.route}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">
            Medication Chart (MAR)
          </h3>
          <button
            onClick={printMeds}
            className="bg-slate-200 text-slate-700 px-3 py-1 rounded text-xs font-bold uppercase"
          >
            🖨️ Print Meds
          </button>
        </div>

        <div className="bg-slate-50 p-4 rounded-xl mb-4 border border-slate-200">
          <div className="flex gap-2 mb-3">
            <button
              onClick={handleVoiceMed}
              className="bg-white border border-slate-300 px-3 py-1 rounded text-xs font-bold hover:bg-slate-100"
            >
              🎙️ Voice
            </button>
            <label className="bg-white border border-slate-300 px-3 py-1 rounded text-xs font-bold hover:bg-slate-100 cursor-pointer">
              {isScanning ? "Processing..." : "📸 Scan Chart (Add All)"}
              <input
                type="file"
                className="hidden"
                accept="image/*"
                onChange={handlePhotoMed}
                disabled={isScanning}
              />
            </label>
            <button
              onClick={() =>
                setTemplateModal({
                  isOpen: true,
                  mode: "load",
                  type: "nursing_drug_chart",
                  onLoad: (content: string) => {
                    try {
                       const loaded = JSON.parse(content);
                       const existing = activeAdmission.nursingMedicationCharts || [];
                       onUpdateAdmission({nursingMedicationCharts: [...existing, ...loaded]});
                    } catch(e) {
                       console.error("Invalid template format", e);
                    }
                  }
                })
              }
              className="bg-white border border-slate-300 px-3 py-1 rounded text-xs font-bold hover:bg-slate-100"
            >
              📋 Load Tmpl
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase">
                Drug Name
              </label>
              <input
                value={medEntry.name}
                onChange={(e) =>
                  setMedEntry({ ...medEntry, name: e.target.value })
                }
                className="w-full border p-2 rounded font-bold text-sm"
                placeholder="Inj. Ceftriaxone 1g"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase">
                Freq/Route
              </label>
              <div className="flex gap-1">
                <input
                  value={medEntry.freq}
                  onChange={(e) =>
                    setMedEntry({ ...medEntry, freq: e.target.value })
                  }
                  className="w-1/2 border p-2 rounded text-xs"
                />
                <input
                  value={medEntry.route}
                  onChange={(e) =>
                    setMedEntry({ ...medEntry, route: e.target.value })
                  }
                  className="w-1/2 border p-2 rounded text-xs"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase">
                Time/Sign
              </label>
              <div className="flex gap-1">
                <input
                  type="time"
                  value={medEntry.time}
                  onChange={(e) =>
                    setMedEntry({ ...medEntry, time: e.target.value })
                  }
                  className="w-1/2 border p-2 rounded text-xs"
                />
                <input
                  value={medEntry.sign}
                  onChange={(e) =>
                    setMedEntry({ ...medEntry, sign: e.target.value })
                  }
                  className="w-1/2 border p-2 rounded text-xs"
                />
              </div>
            </div>
            <button
              onClick={addToMedStaging}
              className="bg-green-600 text-white p-2 rounded font-bold text-xs uppercase"
            >
              Add to List
            </button>
          </div>
        </div>

        {(medStaging.length > 0 ||
          (activeAdmission.nursingMedicationCharts &&
            activeAdmission.nursingMedicationCharts.length > 0)) && (
          <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 font-bold text-slate-500 uppercase sticky top-0">
                <tr>
                  <th>Date</th>
                  <th>Drug</th>
                  <th>Freq</th>
                  <th>Route</th>
                  <th>Time</th>
                  <th>Sign</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {medStaging.map((m, i) => (
                  <tr key={i} className="bg-green-50">
                    <td className="p-2">
                      <input
                        value={m.date}
                        onChange={(e) => {
                          const u = [...medStaging];
                          u[i].date = e.target.value;
                          setMedStaging(u);
                        }}
                        className="w-20 bg-transparent"
                      />
                    </td>
                    <td className="p-2 font-bold">
                      <input
                        value={m.nameOfMedication}
                        onChange={(e) => {
                          const u = [...medStaging];
                          u[i].nameOfMedication = e.target.value;
                          setMedStaging(u);
                        }}
                        className="w-full bg-transparent"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={m.frequency}
                        onChange={(e) => {
                          const u = [...medStaging];
                          u[i].frequency = e.target.value;
                          setMedStaging(u);
                        }}
                        className="w-10 bg-transparent"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={m.route}
                        onChange={(e) => {
                          const u = [...medStaging];
                          u[i].route = e.target.value;
                          setMedStaging(u);
                        }}
                        className="w-10 bg-transparent"
                      />
                    </td>
                    <td className="p-2">{m.morningTime}</td>
                    <td className="p-2">{m.morningSign}</td>
                    <td className="p-2">
                      <button
                        onClick={() =>
                          setMedStaging(
                            medStaging.filter((_, idx) => idx !== i),
                          )
                        }
                        className="text-red-500 font-bold"
                      >
                        &times;
                      </button>
                    </td>
                  </tr>
                ))}
                {(activeAdmission.nursingMedicationCharts || []).map((m) => (
                  <tr key={m.id}>
                    <td className="p-2">{m.date}</td>
                    <td className="p-2 font-bold">{m.nameOfMedication}</td>
                    <td className="p-2">{m.frequency}</td>
                    <td className="p-2">{m.route}</td>
                    <td className="p-2">{m.morningTime}</td>
                    <td className="p-2">{m.morningSign}</td>
                    <td className="p-2"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex gap-2 mt-2">
          {medStaging.length > 0 && (
            <button
              onClick={commitMedications}
              className="flex-grow bg-slate-800 text-white py-2 rounded font-black text-xs uppercase"
            >
              Commit Medications
            </button>
          )}
          {activeAdmission.nursingMedicationCharts &&
            activeAdmission.nursingMedicationCharts.length > 0 && (
              <button
                onClick={() =>
                  setTemplateModal({
                    isOpen: true,
                    mode: "save",
                    type: "nursing_drug_chart",
                    payload: JSON.stringify(
                      activeAdmission.nursingMedicationCharts,
                    ),
                  })
                }
                className="px-3 bg-slate-200 text-slate-600 rounded font-bold text-xs uppercase"
              >
                Save Current List as Tmpl
              </button>
            )}
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">
            Nursing Notes
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const text = prompt("Enter text to expand:");
                if (text) processAiDraft(text);
              }}
              className="bg-purple-100 text-purple-700 px-3 py-1 rounded-lg text-xs font-black uppercase border border-purple-200"
            >
              ✨ AI Auto-Complete
            </button>
            <button
              onClick={startVoice}
              className={`px-3 py-1 rounded-lg text-xs font-black uppercase flex items-center gap-2 ${isRecording ? "bg-red-500 text-white animate-pulse" : "bg-slate-100 text-slate-700"}`}
            >
              🎙️ Voice
            </button>
          </div>
        </div>

        <textarea
          value={nursingNote}
          onChange={(e) => setNursingNote(e.target.value)}
          className="w-full border p-3 rounded-lg font-medium text-sm h-20 mb-2"
          placeholder="Enter nursing observation..."
        />

        <div className="flex justify-end gap-2 mb-4">
          {editingNoteId && (
            <button
              onClick={() => {
                setNursingNote("");
                setEditingNoteId(null);
              }}
              className="text-slate-500 font-bold text-xs uppercase px-3"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleAddNursingNote}
            className="bg-slate-800 text-white px-6 py-2 rounded-lg font-bold text-xs uppercase"
          >
            {editingNoteId ? "Update Note" : "Save Note"}
          </button>
        </div>
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {(activeAdmission.nursingNotes || []).map((n) => (
            <div
              key={n.id}
              className={`p-3 rounded-lg border text-sm ${editingNoteId === n.id ? "bg-blue-50 border-blue-200" : "bg-slate-50 border-slate-100"}`}
            >
              <div className="flex justify-between font-bold text-xs text-slate-500 mb-1">
                <span>{new Date(n.date).toLocaleString()}</span>
                <div className="flex gap-2">
                  <span>{n.nurseName}</span>
                  <button
                    onClick={() => editNote(n)}
                    className="text-blue-600 hover:underline"
                  >
                    Edit
                  </button>
                </div>
              </div>
              <p className="text-slate-800 whitespace-pre-wrap">{n.note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const LabourProgressModule: React.FC<{
  activeAdmission: IpdAdmission;
  onUpdateAdmission: (data: Partial<IpdAdmission>) => void;
}> = ({ activeAdmission, onUpdateAdmission }) => {
  const [entry, setEntry] = useState<Partial<LabourProgressEntry>>({
    cervixDilatation: 0,
    descent: 5,
    fhr: "",
    contractionFreq: "",
    contractionDur: "",
    amnioticFluid: "I", // Intact
    moulding: "0",
    drugsIvFluids: "",
    vitals: { pulse: "", bp: "", temp: "" },
    urine: { protein: "", acetone: "", volume: "" }
  });

  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiParams, setAiParams] = useState({
    dilatation3cm: "",
    ruptureOfMembrane: "",
    liquorCondition: "Clear",
    interventions: "",
    fullDilatation: "",
    deliveryTime: "",
  });
  const [isGenerating, setIsGenerating] = useState(false);

  const handleAdd = () => {
    const newEntry: LabourProgressEntry = {
      id: Date.now().toString(),
      dateTime: new Date().toISOString(),
      fhr: entry.fhr || "",
      amnioticFluid: entry.amnioticFluid || "",
      moulding: entry.moulding || "",
      cervixDilatation: entry.cervixDilatation || 0,
      descent: entry.descent || 5,
      contractionFreq: entry.contractionFreq || "",
      contractionDur: entry.contractionDur || "",
      drugsIvFluids: entry.drugsIvFluids || "",
      vitals: entry.vitals || { pulse: "", bp: "", temp: "" },
      urine: entry.urine || { protein: "", acetone: "", volume: "" },
    };
    const updated = [...(activeAdmission.labourProgress || []), newEntry];
    onUpdateAdmission({ labourProgress: updated });
    setEntry({ cervixDilatation: 0, descent: 5, fhr: "", contractionFreq: "", contractionDur: "", amnioticFluid: "I", moulding: "0", drugsIvFluids: "", vitals: { pulse: "", bp: "", temp: "" }, urine: { protein: "", acetone: "", volume: "" } });
  };

  const handleGenerateAi = async () => {
    setIsGenerating(true);
    try {
        const details = `
        Time and date for 3 cm dilatation: ${aiParams.dilatation3cm}
        Time and date of rupture of membrane: ${aiParams.ruptureOfMembrane}
        Condition of liquor: ${aiParams.liquorCondition}
        Intervention done: ${aiParams.interventions}
        Time of full dilatation: ${aiParams.fullDilatation}
        Time and date of delivery: ${aiParams.deliveryTime}
        `;
        const generated = await generatePartographData(details);
        onUpdateAdmission({ labourProgress: generated });
        setAiModalOpen(false);
    } catch (e) {
        alert("Failed to generate AI Partograph");
    } finally {
        setIsGenerating(false);
    }
  };

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document
      .write(`<html><head><title>WHO Partograph</title><style>table { width: 100%; border-collapse: collapse; font-size: 12px; } th, td { border: 1px solid #000; padding: 4px; text-align: left; }</style></head><body style="padding:20px; font-family:sans-serif;">
            <h2 style="text-align:center; text-transform:uppercase;">Labour Progress (WHO Partograph)</h2>
            <table>
                <thead><tr>
                    <th>Time</th>
                    <th>Cervix (cm)</th>
                    <th>Descent (5-0)</th>
                    <th>FHR</th>
                    <th>Liquor / Moulding</th>
                    <th>Contractions (freq/dur)</th>
                    <th>Drugs & IV Fluids</th>
                    <th>Pulse / BP / Temp</th>
                    <th>Urine (Prot/Acet/Vol)</th>
                </tr></thead>
                <tbody>
                    ${(activeAdmission.labourProgress || []).map((l) => `<tr>
                        <td>${new Date(l.dateTime).toLocaleString()}</td>
                        <td>${l.cervixDilatation}</td>
                        <td>${l.descent}/5</td>
                        <td>${l.fhr}</td>
                        <td>${l.amnioticFluid} / ${l.moulding}</td>
                        <td>${l.contractionFreq} / 10m (${l.contractionDur}s)</td>
                        <td>${l.drugsIvFluids || "-"}</td>
                        <td>${l.vitals?.pulse || "-"} / ${l.vitals?.bp || "-"} / ${l.vitals?.temp || "-"}</td>
                        <td>${l.urine?.protein || "-"}/${l.urine?.acetone || "-"}/${l.urine?.volume || "-"}</td>
                    </tr>`).join("")}
                </tbody>
            </table>
            <br/><br/><div style="text-align:right;"><strong>Signature</strong></div>
        </body></html>`);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-pink-200 shadow-sm relative">
      {aiModalOpen && (
          <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4">
              <div className="bg-white p-6 rounded-2xl w-full max-w-lg shadow-2xl">
                  <h3 className="text-xl font-black text-pink-600 uppercase tracking-tight mb-4 border-b border-pink-100 pb-2">AI Partograph Auto-Populate</h3>
                  <div className="space-y-3 text-sm font-bold text-slate-700">
                      <div><label>Time & Date for 3cm Dilatation</label><input type="datetime-local" className="w-full border p-2 rounded mt-1" value={aiParams.dilatation3cm} onChange={e=>setAiParams({...aiParams, dilatation3cm: e.target.value})} /></div>
                      <div><label>Time & Date of ROM (Rupture of Membrane)</label><input type="datetime-local" className="w-full border p-2 rounded mt-1" value={aiParams.ruptureOfMembrane} onChange={e=>setAiParams({...aiParams, ruptureOfMembrane: e.target.value})} /></div>
                      <div><label>Condition of Liquor</label><select className="w-full border p-2 rounded mt-1" value={aiParams.liquorCondition} onChange={e=>setAiParams({...aiParams, liquorCondition: e.target.value})}><option>Intact</option><option>Clear</option><option>Meconium</option><option>Blood</option><option>Absent</option></select></div>
                      <div><label>Any Intervention Done (Oxytocin, ARM, etc)</label><input type="text" className="w-full border p-2 rounded mt-1" value={aiParams.interventions} onChange={e=>setAiParams({...aiParams, interventions: e.target.value})} placeholder="e.g. Oxytocin drip 2mU/min" /></div>
                      <div><label>Time of Full Dilatation (10cm)</label><input type="datetime-local" className="w-full border p-2 rounded mt-1" value={aiParams.fullDilatation} onChange={e=>setAiParams({...aiParams, fullDilatation: e.target.value})} /></div>
                      <div><label>Time & Date of Delivery</label><input type="datetime-local" className="w-full border p-2 rounded mt-1" value={aiParams.deliveryTime} onChange={e=>setAiParams({...aiParams, deliveryTime: e.target.value})} /></div>
                  </div>
                  <div className="mt-6 flex justify-end gap-3">
                      <button onClick={()=>setAiModalOpen(false)} className="bg-slate-200 text-slate-800 px-4 py-2 rounded-lg text-xs font-bold uppercase transition hover:bg-slate-300">Cancel</button>
                      <button onClick={handleGenerateAi} disabled={isGenerating} className="bg-pink-600 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase shadow flex gap-2 items-center transition hover:bg-pink-700">{isGenerating ? "⏳ Generating..." : "✨ Auto Populate"}</button>
                  </div>
              </div>
          </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-black text-pink-700 uppercase tracking-tight">
          Labour Progress & Partograph
        </h3>
        <div className="flex gap-2">
            <button onClick={() => setAiModalOpen(true)} className="bg-purple-100 text-purple-700 px-4 py-2 rounded-lg font-bold text-xs uppercase hover:bg-purple-200 shadow-sm border border-purple-200 transition-all flex items-center gap-1">✨ AI Auto Populate</button>
            <button
            onClick={handlePrint}
            className="bg-pink-600 text-white px-4 py-2 rounded-lg font-bold text-xs uppercase hover:bg-pink-700 shadow flex items-center gap-1"
            >
            🖨️ Print Partograph
            </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4 items-end">
        <div>
          <label className="block text-[9px] font-bold uppercase text-slate-400">Date/Time</label>
          <input type="datetime-local" defaultValue={new Date().toISOString().slice(0, 16)} className="border p-2 rounded-lg w-full font-bold text-xs" />
        </div>
        <div>
          <label className="block text-[9px] font-bold uppercase text-slate-400">FHR (bpm)</label>
          <input value={entry.fhr || ''} onChange={(e) => setEntry({ ...entry, fhr: e.target.value })} className="border p-2 rounded-lg w-full font-bold text-xs" placeholder="140" />
        </div>
        <div>
          <label className="block text-[9px] font-bold uppercase text-slate-400">Liquor</label>
          <select value={entry.amnioticFluid} onChange={(e) => setEntry({ ...entry, amnioticFluid: e.target.value })} className="border p-2 rounded-lg w-full font-bold text-xs bg-white">
              <option value="I">Intact (I)</option>
              <option value="C">Clear (C)</option>
              <option value="M">Meconium (M)</option>
              <option value="B">Blood (B)</option>
          </select>
        </div>
        <div>
          <label className="block text-[9px] font-bold uppercase text-slate-400">Moulding (0-3)</label>
          <input type="number" min="0" max="3" value={entry.moulding || ''} onChange={(e) => setEntry({ ...entry, moulding: e.target.value })} className="border p-2 rounded-lg w-full font-bold text-xs" />
        </div>
        <div>
          <label className="block text-[9px] font-bold uppercase text-slate-400">Cervix (cm)</label>
          <input type="number" value={entry.cervixDilatation} onChange={(e) => setEntry({ ...entry, cervixDilatation: Number(e.target.value) })} className="border p-2 rounded-lg w-full font-bold text-xs" />
        </div>
        <div>
          <label className="block text-[9px] font-bold uppercase text-slate-400">Descent (5-0)</label>
          <input type="number" value={entry.descent} onChange={(e) => setEntry({ ...entry, descent: Number(e.target.value) })} className="border p-2 rounded-lg w-full font-bold text-xs" />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4 items-end">
        <div>
          <label className="block text-[9px] font-bold uppercase text-slate-400">Contractions / 10m</label>
          <input value={entry.contractionFreq || ''} onChange={(e) => setEntry({ ...entry, contractionFreq: e.target.value })} className="border p-2 rounded-lg w-full font-bold text-xs" placeholder="3" />
        </div>
        <div>
          <label className="block text-[9px] font-bold uppercase text-slate-400">Contr. Duration (s)</label>
          <input value={entry.contractionDur || ''} onChange={(e) => setEntry({ ...entry, contractionDur: e.target.value })} className="border p-2 rounded-lg w-full font-bold text-xs" placeholder="40" />
        </div>
        <div>
          <label className="block text-[9px] font-bold uppercase text-slate-400">Pulse/BP/Temp</label>
          <div className="flex gap-1">
             <input value={entry.vitals?.pulse || ''} onChange={(e) => setEntry({ ...entry, vitals: { ...entry.vitals!, pulse: e.target.value }})} className="border p-2 rounded w-1/3 font-bold text-xs" placeholder="PR" />
             <input value={entry.vitals?.bp || ''} onChange={(e) => setEntry({ ...entry, vitals: { ...entry.vitals!, bp: e.target.value }})} className="border p-2 rounded w-1/3 font-bold text-xs" placeholder="BP" />
             <input value={entry.vitals?.temp || ''} onChange={(e) => setEntry({ ...entry, vitals: { ...entry.vitals!, temp: e.target.value }})} className="border p-2 rounded w-1/3 font-bold text-xs" placeholder="Temp" />
          </div>
        </div>
        <div>
          <label className="block text-[9px] font-bold uppercase text-slate-400">Urine (Prot/Acet/Vol)</label>
          <div className="flex gap-1">
             <input value={entry.urine?.protein || ''} onChange={(e) => setEntry({ ...entry, urine: { ...entry.urine!, protein: e.target.value }})} className="border p-2 rounded w-1/3 font-bold text-xs" placeholder="Prot" />
             <input value={entry.urine?.acetone || ''} onChange={(e) => setEntry({ ...entry, urine: { ...entry.urine!, acetone: e.target.value }})} className="border p-2 rounded w-1/3 font-bold text-xs" placeholder="Acet" />
             <input value={entry.urine?.volume || ''} onChange={(e) => setEntry({ ...entry, urine: { ...entry.urine!, volume: e.target.value }})} className="border p-2 rounded w-1/3 font-bold text-xs" placeholder="Vol" />
          </div>
        </div>
        <div>
          <label className="block text-[9px] font-bold uppercase text-slate-400">Drugs / IV Fluids / Oxytocin</label>
          <input value={entry.drugsIvFluids || ''} onChange={(e) => setEntry({ ...entry, drugsIvFluids: e.target.value })} className="border p-2 rounded-lg w-full font-bold text-xs" placeholder="RL 500ml @ 100ml/h" />
        </div>
      </div>

      <button
        onClick={handleAdd}
        className="bg-slate-800 text-white px-6 py-3 rounded-xl font-bold text-xs uppercase mb-6 shadow w-full hover:bg-slate-900 transition"
      >
        ➕ Add Log Entry
      </button>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs whitespace-nowrap">
          <thead className="bg-slate-100 font-bold text-slate-500 uppercase text-[10px]">
            <tr className="divide-x divide-slate-200">
              <th className="p-3 whitespace-nowrap sticky left-0 bg-slate-100 border-b border-slate-200 min-w-[80px]">Time</th>
              <th className="p-3 border-b border-slate-200 text-center text-pink-600 bg-pink-50" colSpan={2}>Cervicograph</th>
              <th className="p-3 border-b border-slate-200 text-center" colSpan={4}>Fetal Condition</th>
              <th className="p-3 border-b border-slate-200 text-center" colSpan={2}>Maternal Condition</th>
              <th className="p-3 border-b border-slate-200 text-center">Intervention</th>
            </tr>
            <tr className="divide-x divide-slate-200 border-b border-slate-200 bg-white">
              <th className="p-2 sticky left-0 bg-white shadow-[1px_0_0_#e2e8f0]"></th>
              <th className="p-2 bg-pink-50/30 text-pink-700 text-center">Cx (cm)</th>
              <th className="p-2 bg-pink-50/30 text-pink-700 text-center">Desc (5/5)</th>
              <th className="p-2 text-center text-blue-700">FHR (bpm)</th>
              <th className="p-2 text-center text-blue-700">Liquor</th>
              <th className="p-2 text-center text-blue-700">Moulding</th>
              <th className="p-2 text-center text-blue-700">Contr. (/10m)</th>
              <th className="p-2 text-center text-orange-600">Vit (P/BP/T)</th>
              <th className="p-2 text-center text-orange-600">Urine (P/A/V)</th>
              <th className="p-2 text-center text-green-700">Drugs / IV</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(activeAdmission.labourProgress || []).sort((a,b) => Date.parse(a.dateTime) - Date.parse(b.dateTime)).map((l) => (
              <tr key={l.id} className="divide-x divide-slate-100 hover:bg-slate-50/50">
                <td className="p-2 sticky left-0 bg-white group-hover:bg-slate-50 shadow-[1px_0_0_#f1f5f9] font-bold text-slate-800">
                  {new Date(l.dateTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </td>
                <td className="p-2 text-center font-black text-pink-600 bg-pink-50/30">{l.cervixDilatation}</td>
                <td className="p-2 text-center font-bold text-slate-600 bg-pink-50/30">{l.descent}/5</td>
                <td className="p-2 text-center font-bold">{l.fhr || "-"}</td>
                <td className="p-2 text-center font-bold">{l.amnioticFluid || "-"}</td>
                <td className="p-2 text-center font-bold">{l.moulding || "-"}</td>
                <td className="p-2 text-center"><span className="font-bold">{l.contractionFreq||"-"}</span> <span className="text-[10px] text-slate-400">({l.contractionDur}s)</span></td>
                <td className="p-2 text-center text-[10px]"><span className="font-bold">{l.vitals?.pulse||"-"}</span> / {l.vitals?.bp||"-"} / {l.vitals?.temp||"-"}</td>
                <td className="p-2 text-center text-[10px]">{l.urine?.protein||"-"}/{l.urine?.acetone||"-"}/{l.urine?.volume||"-"}</td>
                <td className="p-2 text-[10px] max-w-[150px] truncate" title={l.drugsIvFluids}>{l.drugsIvFluids || "-"}</td>
              </tr>
            ))}
            {(!activeAdmission.labourProgress || activeAdmission.labourProgress.length === 0) && (
              <tr>
                <td colSpan={10} className="p-8 text-center text-slate-400 italic">No partograph entires logged yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const OperativeNotesModule: React.FC<{
  activeAdmission: IpdAdmission;
  onUpdateAdmission: (data: Partial<IpdAdmission>) => void;
  billingRates: ServicePrices;
  setTemplateModal: any;
}> = ({ activeAdmission, onUpdateAdmission, billingRates, setTemplateModal }) => {
  const [note, setNote] = useState<Partial<PostOperativeNote>>({
    procedureName: "",
    surgeonName: activeAdmission.primaryDoctor,
    preOpDiagnosis: "",
    procedureDetails: "",
    postOpOrders: "",
    anesthetistName: "",
    anesthesiaType: "",
    anesthesiaNotes: "",
    babyDetails: {
      sex: "Male",
      weight: "",
      date: "",
      time: "",
      presentation: "",
    },
  });
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [isAiProcessing, setIsAiProcessing] = useState(false);

  const processAiDraft = async (text: string) => {
    setIsAiProcessing(true);
    try {
      const generated = await generateOperativeNote(text);
      setNote((prev) => ({ ...prev, ...generated }));
    } catch (e) {
      alert("AI processing failed.");
    } finally {
      setIsAiProcessing(false);
    }
  };
  const { isRecording, start: startVoice } = useAiVoiceInput((text) =>
    processAiDraft(text),
  );

  const isDelivery = () => {
    const proc = note.procedureName?.toLowerCase() || "";
    return [
      "lscs",
      "ftnd",
      "delivery",
      "section",
      "labor",
      "iud",
      "birth",
    ].some((k) => proc.includes(k));
  };

  const handleSave = () => {
    // Auto-Billing Check
    let newCharges = [...(activeAdmission.charges || [])];
    let totalAdded = 0;

    if (!note.chargesAdded) {
      // Find procedure charge
      const procCharge = Object.values(billingRates).find(
        (r) => r.name === note.procedureName && r.category === "operation",
      );
      if (procCharge) {
        newCharges.push({
          id: Date.now() + "p",
          date: new Date().toISOString(),
          description: procCharge.name,
          amount: procCharge.price,
          category: "operation",
        });
        totalAdded += procCharge.price;
      }
      // Find anesthesia charge
      const anesCharge = Object.values(billingRates).find(
        (r) => r.name === note.anesthesiaType && r.category === "anesthesia",
      );
      if (anesCharge) {
        newCharges.push({
          id: Date.now() + "a",
          date: new Date().toISOString(),
          description: anesCharge.name,
          amount: anesCharge.price,
          category: "anesthesia",
        });
        totalAdded += anesCharge.price;
      }
    }

    const newNote: PostOperativeNote = {
      id: editingNoteId || Date.now().toString(),
      date: new Date().toISOString(),
      procedureName: note.procedureName || "",
      surgeonName: note.surgeonName || "",
      preOpDiagnosis: note.preOpDiagnosis || "",
      procedureDetails: note.procedureDetails || "",
      hemostasis: note.hemostasis || "",
      closure: note.closure || "",
      postOpOrders: note.postOpOrders || "",
      preOpNotes: note.preOpNotes || "",
      anesthetistName: note.anesthetistName,
      anesthesiaType: note.anesthesiaType,
      anesthesiaNotes: note.anesthesiaNotes,
      babyDetails: isDelivery() ? note.babyDetails : undefined,
      chargesAdded: true,
    };

    let updatedNotes = [...(activeAdmission.operativeNotes || [])];
    if (editingNoteId) {
      updatedNotes = updatedNotes.map((n) =>
        n.id === editingNoteId ? newNote : n,
      );
    } else {
      updatedNotes.push(newNote);
    }

    // If delivery, sync to deliveryDetails for register view
    let deliveryUpdate = {};
    if (isDelivery() && note.babyDetails) {
      deliveryUpdate = {
        deliveryDetails: {
          deliveryDate: note.babyDetails.date,
          deliveryTime: note.babyDetails.time,
          method: note.procedureName.toLowerCase().includes("lscs")
            ? "LSCS"
            : "Vaginal",
          babySex: note.babyDetails.sex,
          babyWeight: note.babyDetails.weight,
          birthStatus: "Live",
        },
      };
    }

    onUpdateAdmission({
      operativeNotes: updatedNotes,
      charges: newCharges,
      totalBill: (activeAdmission.totalBill || 0) + totalAdded,
      ...deliveryUpdate,
    });

    if (totalAdded > 0) alert(`Note Saved. Added ₹${totalAdded} to bill.`);
    else alert("Operative Note Saved");

    setNote({
      procedureName: "",
      surgeonName: activeAdmission.primaryDoctor,
      preOpDiagnosis: "",
      procedureDetails: "",
      postOpOrders: "",
      anesthetistName: "",
      anesthesiaType: "",
      anesthesiaNotes: "",
      babyDetails: {
        sex: "Male",
        weight: "",
        date: "",
        time: "",
        presentation: "",
      },
    });
    setEditingNoteId(null);
  };

  const handleEdit = (n: PostOperativeNote) => {
    setNote(n);
    setEditingNoteId(n.id);
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this operative note?")) {
      onUpdateAdmission({
        operativeNotes: activeAdmission.operativeNotes?.filter(
          (n) => n.id !== id,
        ),
      });
    }
  };

  const handlePrint = (n: PostOperativeNote) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document
      .write(`<html><head><title>Operative Note</title></head><body style="padding:20px; font-family:sans-serif;">
            <h2 style="text-align:center; text-transform:uppercase;">Operative Note</h2>
            <div style="border-bottom:1px solid #000; padding-bottom:10px; margin-bottom:15px;">
                <p><strong>Procedure:</strong> ${n.procedureName}</p>
                <p><strong>Surgeon:</strong> ${n.surgeonName} | <strong>Anesthetist:</strong> ${n.anesthetistName || "-"}</p>
                <p><strong>Anesthesia:</strong> ${n.anesthesiaType || "-"}</p>
            </div>
            <p><strong>Pre-op Diagnosis:</strong> ${n.preOpDiagnosis}</p>
            <p><strong>Details:</strong><br/>${n.procedureDetails}</p>
            ${n.babyDetails ? `<div style="border:1px solid #ccc; padding:10px; margin:10px 0;"><strong>Baby Details:</strong> Sex: ${n.babyDetails.sex}, Wt: ${n.babyDetails.weight}, Time: ${n.babyDetails.time}, Presentation: ${n.babyDetails.presentation || "-"}</div>` : ""}
            <p><strong>Post-op Orders:</strong><br/>${n.postOpOrders}</p>
            <br/><div style="text-align:right;"><strong>Surgeon Signature</strong></div>
        </body></html>`);
    printWindow.document.close();
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">
          Operation Theatre Notes
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => setTemplateModal({ 
              isOpen: true, 
              mode: "load", 
              type: "operative_note",
              onLoad: (content: string) => {
                try {
                   const loaded = JSON.parse(content);
                   setNote(loaded);
                } catch(e) {
                   setNote({...note, procedureDetails: content});
                }
              }
            })}
            className="bg-slate-100 text-slate-700 px-3 py-1 rounded-lg text-xs font-black uppercase border border-slate-200"
          >
            📂 Load Tmpl
          </button>
          <button
            onClick={() => setTemplateModal({ isOpen: true, mode: "save", type: "operative_note", payload: JSON.stringify(note) })}
            className="bg-slate-100 text-slate-700 px-3 py-1 rounded-lg text-xs font-black uppercase border border-slate-200"
          >
            💾 Save Tmpl
          </button>
          <button
            onClick={() => {
              const text = prompt("Dictate procedure details:");
              if (text) processAiDraft(text);
            }}
            className="bg-purple-100 text-purple-700 px-3 py-1 rounded-lg text-xs font-black uppercase border border-purple-200"
          >
            ✨ AI Auto-Complete
          </button>
          <button
            onClick={startVoice}
            className={`px-3 py-1 rounded-lg text-xs font-black uppercase flex items-center gap-2 ${isRecording ? "bg-red-500 text-white animate-pulse" : "bg-slate-100 text-slate-700"}`}
          >
            🎙️ Voice
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase">
              Procedure Name
            </label>
            <input
              list="procedures"
              value={note.procedureName}
              onChange={(e) =>
                setNote({ ...note, procedureName: e.target.value })
              }
              className="border p-2 rounded-lg font-bold text-sm w-full"
              placeholder="e.g. LSCS"
            />
            <datalist id="procedures">
              {Object.values(billingRates)
                .filter((r) => r.category === "operation")
                .map((r, idx) => (
                  <option key={`${r.name}-${idx}`} value={r.name} />
                ))}
            </datalist>
          </div>
          <div className="md:col-span-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase">
              Surgeon Name
            </label>
            <input
              value={note.surgeonName}
              onChange={(e) =>
                setNote({ ...note, surgeonName: e.target.value })
              }
              className="border p-2 rounded-lg font-bold text-sm w-full"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">
              Anesthesia Type
            </label>
            <input
              list="anesthesia"
              value={note.anesthesiaType}
              onChange={(e) =>
                setNote({ ...note, anesthesiaType: e.target.value })
              }
              className="border p-2 rounded-lg font-bold text-sm w-full"
              placeholder="e.g. Spinal"
            />
            <datalist id="anesthesia">
              {Object.values(billingRates)
                .filter((r) => r.category === "anesthesia")
                .map((r, idx) => (
                  <option key={`${r.name}-${idx}`} value={r.name} />
                ))}
            </datalist>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">
              Anesthetist Name
            </label>
            <input
              value={note.anesthetistName}
              onChange={(e) =>
                setNote({ ...note, anesthetistName: e.target.value })
              }
              className="border p-2 rounded-lg font-bold text-sm w-full"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase">
              Anesthesia Notes
            </label>
            <input
              value={note.anesthesiaNotes}
              onChange={(e) =>
                setNote({ ...note, anesthesiaNotes: e.target.value })
              }
              className="border p-2 rounded-lg font-bold text-sm w-full"
              placeholder="Drugs used, levels..."
            />
          </div>
        </div>

        {isDelivery() && (
          <div className="bg-pink-50 p-4 rounded-xl border border-pink-100">
            <h4 className="text-xs font-black text-pink-600 uppercase mb-2">
              Baby Details
            </h4>
            <div className="grid grid-cols-5 gap-2">
              <input
                type="date"
                value={note.babyDetails?.date}
                onChange={(e) =>
                  setNote({
                    ...note,
                    babyDetails: { ...note.babyDetails!, date: e.target.value },
                  })
                }
                className="border p-1 rounded text-xs"
              />
              <input
                type="time"
                value={note.babyDetails?.time}
                onChange={(e) =>
                  setNote({
                    ...note,
                    babyDetails: { ...note.babyDetails!, time: e.target.value },
                  })
                }
                className="border p-1 rounded text-xs"
              />
              <select
                value={note.babyDetails?.sex}
                onChange={(e) =>
                  setNote({
                    ...note,
                    babyDetails: {
                      ...note.babyDetails!,
                      sex: e.target.value as any,
                    },
                  })
                }
                className="border p-1 rounded text-xs"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
              <input
                placeholder="Weight (kg)"
                value={note.babyDetails?.weight}
                onChange={(e) =>
                  setNote({
                    ...note,
                    babyDetails: {
                      ...note.babyDetails!,
                      weight: e.target.value,
                    },
                  })
                }
                className="border p-1 rounded text-xs"
              />
              <input
                placeholder="Presentation"
                value={note.babyDetails?.presentation}
                onChange={(e) =>
                  setNote({
                    ...note,
                    babyDetails: {
                      ...note.babyDetails!,
                      presentation: e.target.value,
                    },
                  })
                }
                className="border p-1 rounded text-xs"
              />
            </div>
          </div>
        )}

        <textarea
          placeholder="Pre-op Diagnosis / Notes"
          value={note.preOpDiagnosis}
          onChange={(e) => setNote({ ...note, preOpDiagnosis: e.target.value })}
          className="w-full border p-2 rounded-lg h-16 text-sm"
        />
        <textarea
          placeholder="Procedure Details"
          value={note.procedureDetails}
          onChange={(e) =>
            setNote({ ...note, procedureDetails: e.target.value })
          }
          className="w-full border p-2 rounded-lg h-24 text-sm"
        />
        <textarea
          placeholder="Post-op Orders"
          value={note.postOpOrders}
          onChange={(e) => setNote({ ...note, postOpOrders: e.target.value })}
          className="w-full border p-2 rounded-lg h-16 text-sm"
        />

        <div className="flex justify-end gap-2">
          {editingNoteId && (
            <button
              onClick={() => {
                setEditingNoteId(null);
                setNote({});
              }}
              className="text-slate-500 font-bold text-xs uppercase px-4"
            >
              Cancel
            </button>
          )}
          <button
            onClick={() => handlePrint(note as PostOperativeNote)}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold text-xs uppercase hover:bg-blue-700"
          >
            Print Note
          </button>
          <button
            onClick={handleSave}
            className="bg-red-600 text-white px-6 py-2 rounded-lg font-bold text-xs uppercase hover:bg-red-700"
          >
            {editingNoteId ? "Update Note" : "Save & Bill"}
          </button>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {(activeAdmission.operativeNotes || []).map((op) => (
          <div
            key={op.id}
            className="bg-slate-50 p-4 rounded-xl border border-slate-200 group relative"
          >
            <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handlePrint(op)}
                className="text-blue-500 font-bold text-xs"
              >
                Print
              </button>
              <button
                onClick={() => handleEdit(op)}
                className="text-slate-600 font-bold text-xs"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(op.id)}
                className="text-red-500 font-bold text-xs"
              >
                Delete
              </button>
            </div>
            <div className="flex justify-between font-bold text-xs text-slate-500 mb-2">
              <span>{new Date(op.date).toLocaleDateString()}</span>
              <span>{op.procedureName}</span>
            </div>
            <p className="text-sm font-bold text-slate-800 mb-1">Details:</p>
            <p className="text-xs text-slate-600 whitespace-pre-wrap line-clamp-2">
              {op.procedureDetails}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export const DischargeSummaryModule: React.FC<{
  activeAdmission: IpdAdmission;
  onUpdateAdmission: (data: Partial<IpdAdmission>) => void;
  setTemplateModal: any;
  patient: Patient;
}> = ({ activeAdmission, onUpdateAdmission, setTemplateModal, patient }) => {
  // Initial state setup to pull from existing data or activeAdmission
  const [summary, setSummary] = useState<IpdDischargeSummary>(
    activeAdmission.dischargeSummary || {
      admissionDate: activeAdmission.admissionDate,
      dischargeDate: new Date().toISOString().slice(0, 10),
      diagnosis: activeAdmission.diagnosis,
      bloodGroup: "",
      complaints: activeAdmission.admissionNote?.chiefComplaints || "",
      obstetricHistory:
        activeAdmission.admissionNote?.obstetricHistory ||
        patient.obstetricHistory ||
        "",
      menstrualHistory: activeAdmission.admissionNote?.menstrualHistory || "",
      examinationOnAdmission: activeAdmission.admissionNote
        ? `${activeAdmission.admissionNote.generalExamination}\n${activeAdmission.admissionNote.systemicExamination}\n${activeAdmission.admissionNote.localExamination}`
        : "",
      operativeNotesSummary: "",
      babyDetails: {
        weight: "",
        time: "",
        date: "",
        sex: "Male",
        presentation: "",
      },
      treatmentGiven: "",
      examinationOnDischarge: "",
      adviceOnDischarge: "",
      followUp: "",
      courseInHospital: "",
      investigations: "",
    },
  );

  useEffect(() => {
    // Auto-fetch logic on mount if fields are empty
    let updated = { ...summary };
    let hasUpdates = false;

    // Fetch Operative Details
    if (
      !updated.operativeNotesSummary &&
      activeAdmission.operativeNotes &&
      activeAdmission.operativeNotes.length > 0
    ) {
      const op = activeAdmission.operativeNotes[0]; // Use first or most relevant
      updated.operativeNotesSummary = `Procedure: ${op.procedureName}\nFindings: ${op.procedureDetails}`;
      if (op.babyDetails) {
        updated.babyDetails = op.babyDetails;
      }
      hasUpdates = true;
    }

    // Fetch Treatment from Rounds
    if (
      !updated.treatmentGiven &&
      activeAdmission.roundNotes &&
      activeAdmission.roundNotes.length > 0
    ) {
      const aggregatedMeds: Record<string, Set<string>> = {};
      activeAdmission.roundNotes.forEach((note) => {
        const date = note.timestamp.slice(0, 10);
        if (note.medication) {
          note.medication.split("\n").forEach((line) => {
            const cleanLine = line.trim().toUpperCase();
            // Exclude IV fluids and empty lines
            if (
              cleanLine &&
              !cleanLine.startsWith("IVF") &&
              !["NS", "RL", "DNS", "D5"].includes(cleanLine)
            ) {
              if (!aggregatedMeds[cleanLine])
                aggregatedMeds[cleanLine] = new Set();
              aggregatedMeds[cleanLine].add(date);
            }
          });
        }
      });
      updated.treatmentGiven = Object.entries(aggregatedMeds)
        .map(
          ([med, dates]) =>
            `${med} FOR ${dates.size} DAY${dates.size > 1 ? "S" : ""}`,
        )
        .join("\n");
      hasUpdates = true;
    }

    if (hasUpdates) setSummary(updated);
  }, [activeAdmission]);

  const handleSave = () => {
    onUpdateAdmission({ dischargeSummary: summary });
    alert("Discharge Summary Saved");
  };

  const handlePrintDischargeCard = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const docName = activeAdmission.primaryDoctor;

    printWindow.document.write(`
            <html>
            <head>
                <title>Discharge Summary</title>
                <style>
                    body { font-family: 'Times New Roman', Times, serif; padding: 20px; max-width: 210mm; margin: 0 auto; color: #000; }
                    h1 { text-align: center; font-size: 24px; font-weight: bold; margin-bottom: 20px; }
                    .header-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 14px; }
                    .header-table td { border: 1px solid #94a3b8; padding: 4px 8px; }
                    .header-label { font-weight: bold; background-color: #e0f2fe; width: 15%; }
                    
                    .section { margin-bottom: 15px; border: 1px solid #94a3b8; }
                    .section-header { background-color: #dbeafe; padding: 5px 10px; font-weight: bold; border-bottom: 1px solid #94a3b8; font-size: 14px; text-decoration: underline; }
                    .section-content { padding: 8px 10px; font-size: 13px; white-space: pre-wrap; line-height: 1.4; }
                    
                    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #94a3b8; }
                    .grid-item { padding: 0; border-right: 1px solid #94a3b8; }
                    .grid-item:last-child { border-right: none; }
                    
                    .footer { margin-top: 40px; text-align: right; font-weight: bold; font-size: 14px; }
                    .footer p { margin: 2px 0; }
                    
                    @media print {
                        body { padding: 0; margin: 0; }
                        .header-label { background-color: #e0f2fe !important; -webkit-print-color-adjust: exact; }
                        .section-header { background-color: #dbeafe !important; -webkit-print-color-adjust: exact; }
                    }
                </style>
            </head>
            <body>
                <h1>Discharge Summary</h1>
                
                <table class="header-table">
                    <tr>
                        <td class="header-label">Name</td>
                        <td colspan="3"><b>${patient.name}</b></td>
                    </tr>
                    <tr>
                        <td class="header-label">Postal Address</td>
                        <td colspan="2">${patient.address}</td>
                        <td style="width: 20%;"><b>AGE:</b> ${patient.age}</td>
                    </tr>
                    <tr>
                        <td class="header-label">Father/Husband</td>
                        <td colspan="3"></td>
                    </tr>
                    <tr>
                        <td class="header-label">Date of admission</td>
                        <td>${new Date(summary.admissionDate).toLocaleDateString()}</td>
                        <td class="header-label" style="width: 15%;">Blood Group</td>
                        <td>${summary.bloodGroup || ""}</td>
                    </tr>
                    <tr>
                        <td class="header-label">Date of Discharge</td>
                        <td>${new Date(summary.dischargeDate).toLocaleDateString()}</td>
                        <td colspan="2"></td>
                    </tr>
                    <tr>
                        <td class="header-label">Prov. Diagnosis</td>
                        <td colspan="3"><b>${summary.diagnosis}</b></td>
                    </tr>
                </table>

                <div class="section">
                    <div class="grid-2">
                        <div class="grid-item">
                            <div class="section-header">Chief Complaints:</div>
                            <div class="section-content">${summary.complaints}</div>
                        </div>
                        <div class="grid-item">
                            <div class="section-header">Obstetric History:</div>
                            <div class="section-content">${summary.obstetricHistory}</div>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <div class="grid-2">
                        <div class="grid-item">
                            <div class="section-header">Menstrual History:</div>
                            <div class="section-content">${summary.menstrualHistory}</div>
                        </div>
                        <div class="grid-item">
                            <div class="section-header">Examination Findings on admission:</div>
                            <div class="section-content">${summary.examinationOnAdmission}</div>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <div class="grid-2">
                        <div class="grid-item">
                            <div class="section-header">Operative Notes:</div>
                            <div class="section-content">
                                ${summary.operativeNotesSummary}
                                ${summary.babyDetails ? `<br/><b>Baby Details:</b> Sex: ${summary.babyDetails.sex}, Wt: ${summary.babyDetails.weight}, Time: ${summary.babyDetails.time}, Pres: ${summary.babyDetails.presentation || "-"}` : ""}
                            </div>
                        </div>
                        <div class="grid-item">
                            <div class="section-header">Treatment Given:</div>
                            <div class="section-content">${summary.treatmentGiven}</div>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <div class="grid-2">
                        <div class="grid-item">
                            <div class="section-header">Examination Findings on Discharge:</div>
                            <div class="section-content">${summary.examinationOnDischarge}</div>
                        </div>
                        <div class="grid-item">
                            <div class="section-header">Treatment Advised:</div>
                            <div class="section-content">${summary.adviceOnDischarge}<br/><b>Follow up:</b> ${summary.followUp}</div>
                        </div>
                    </div>
                </div>

                <div class="footer">
                    <br/><br/><br/>
                    <p>${docName}</p>
                    <p>MD obs & Gyn</p>
                </div>
                
                <script>window.print();</script>
            </body>
            </html>
        `);
    printWindow.document.close();
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
      <div className="flex justify-between items-center border-b pb-4 mb-2">
        <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">
          Discharge Card
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() =>
              setTemplateModal({
                isOpen: true,
                mode: "load",
                type: "discharge",
                onLoad: (content: string) => {
                  try {
                    const loaded = JSON.parse(content);
                    setSummary(loaded);
                  } catch(e) {
                    setSummary({...summary, adviceOnDischarge: content});
                  }
                }
              })
            }
            className="bg-slate-100 text-slate-600 px-3 py-1 rounded text-xs font-bold uppercase hover:bg-slate-200"
          >
            📂 Load Tmpl
          </button>
          <button
            onClick={() =>
              setTemplateModal({
                isOpen: true,
                mode: "save",
                type: "discharge",
                payload: summary,
              })
            }
            className="bg-slate-100 text-slate-600 px-3 py-1 rounded text-xs font-bold uppercase hover:bg-slate-200"
          >
            💾 Save Tmpl
          </button>
          <button
            onClick={handlePrintDischargeCard}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg font-bold text-xs uppercase shadow hover:bg-purple-700"
          >
            🖨️ Print Card
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Admission Date
          </label>
          <input
            type="date"
            value={summary.admissionDate}
            onChange={(e) =>
              setSummary({ ...summary, admissionDate: e.target.value })
            }
            className="w-full bg-white border rounded px-2 py-1 text-sm font-bold"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Discharge Date
          </label>
          <input
            type="date"
            value={summary.dischargeDate}
            onChange={(e) =>
              setSummary({ ...summary, dischargeDate: e.target.value })
            }
            className="w-full bg-white border rounded px-2 py-1 text-sm font-bold"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Diagnosis
          </label>
          <input
            value={summary.diagnosis}
            onChange={(e) =>
              setSummary({ ...summary, diagnosis: e.target.value })
            }
            className="w-full bg-white border rounded px-2 py-1 text-sm font-bold"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Blood Group
          </label>
          <input
            value={summary.bloodGroup}
            onChange={(e) =>
              setSummary({ ...summary, bloodGroup: e.target.value })
            }
            className="w-full bg-white border rounded px-2 py-1 text-sm font-bold"
            placeholder="e.g. B Positive"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Chief Complaints
          </label>
          <textarea
            value={summary.complaints}
            onChange={(e) =>
              setSummary({ ...summary, complaints: e.target.value })
            }
            className="w-full border rounded p-2 text-sm h-20"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Obstetric History
          </label>
          <textarea
            value={summary.obstetricHistory}
            onChange={(e) =>
              setSummary({ ...summary, obstetricHistory: e.target.value })
            }
            className="w-full border rounded p-2 text-sm h-20"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Menstrual History
          </label>
          <textarea
            value={summary.menstrualHistory}
            onChange={(e) =>
              setSummary({ ...summary, menstrualHistory: e.target.value })
            }
            className="w-full border rounded p-2 text-sm h-24"
            placeholder="AOM, LMP, EDD, POG..."
          />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Examination on Admission
          </label>
          <textarea
            value={summary.examinationOnAdmission}
            onChange={(e) =>
              setSummary({ ...summary, examinationOnAdmission: e.target.value })
            }
            className="w-full border rounded p-2 text-sm h-24"
            placeholder="GC, Vitals, Systemic, P/A, P/V..."
          />
        </div>
      </div>

      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
        <label className="text-[10px] font-bold text-blue-600 uppercase mb-2 block">
          Operative Notes Summary
        </label>
        <textarea
          value={summary.operativeNotesSummary}
          onChange={(e) =>
            setSummary({ ...summary, operativeNotesSummary: e.target.value })
          }
          className="w-full border rounded p-2 text-sm h-20 mb-2"
          placeholder="Procedure details..."
        />
        <div className="grid grid-cols-5 gap-2">
          <input
            value={summary.babyDetails?.sex}
            onChange={(e) =>
              setSummary({
                ...summary,
                babyDetails: {
                  ...summary.babyDetails!,
                  sex: e.target.value as any,
                },
              })
            }
            placeholder="Baby Sex"
            className="border rounded p-1 text-xs"
          />
          <input
            value={summary.babyDetails?.weight}
            onChange={(e) =>
              setSummary({
                ...summary,
                babyDetails: {
                  ...summary.babyDetails!,
                  weight: e.target.value,
                },
              })
            }
            placeholder="Weight"
            className="border rounded p-1 text-xs"
          />
          <input
            value={summary.babyDetails?.time}
            onChange={(e) =>
              setSummary({
                ...summary,
                babyDetails: { ...summary.babyDetails!, time: e.target.value },
              })
            }
            placeholder="Time"
            className="border rounded p-1 text-xs"
          />
          <input
            value={summary.babyDetails?.date}
            onChange={(e) =>
              setSummary({
                ...summary,
                babyDetails: { ...summary.babyDetails!, date: e.target.value },
              })
            }
            placeholder="Date"
            className="border rounded p-1 text-xs"
          />
          <input
            value={summary.babyDetails?.presentation}
            onChange={(e) =>
              setSummary({
                ...summary,
                babyDetails: {
                  ...summary.babyDetails!,
                  presentation: e.target.value,
                },
              })
            }
            placeholder="Presentation"
            className="border rounded p-1 text-xs"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Treatment Given
          </label>
          <textarea
            value={summary.treatmentGiven}
            onChange={(e) =>
              setSummary({ ...summary, treatmentGiven: e.target.value })
            }
            className="w-full border rounded p-2 text-sm h-32"
            placeholder="Meds list..."
          />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Exam on Discharge
          </label>
          <textarea
            value={summary.examinationOnDischarge}
            onChange={(e) =>
              setSummary({ ...summary, examinationOnDischarge: e.target.value })
            }
            className="w-full border rounded p-2 text-sm h-32"
            placeholder="GC, Vitals, Breast, Baby status..."
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Treatment Advised & Follow Up
          </label>
          <textarea
            value={summary.adviceOnDischarge}
            onChange={(e) =>
              setSummary({ ...summary, adviceOnDischarge: e.target.value })
            }
            className="w-full border rounded p-2 text-sm h-24"
            placeholder="Immunization, Diet, Rx..."
          />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase">
            Follow Up Date/Time
          </label>
          <input
            value={summary.followUp}
            onChange={(e) =>
              setSummary({ ...summary, followUp: e.target.value })
            }
            className="w-full border rounded p-2 text-sm font-bold"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          className="bg-green-600 text-white px-6 py-3 rounded-lg font-bold text-xs uppercase flex-1 shadow-lg hover:bg-green-700"
        >
          Save Discharge Summary
        </button>
        <button
          onClick={() => {
            handleSave();
            onUpdateAdmission({ status: "discharged" });
          }}
          className="bg-red-600 text-white px-6 py-3 rounded-lg font-bold text-xs uppercase flex-1 shadow-lg hover:bg-red-700"
        >
          Vacate Bed
        </button>
      </div>
    </div>
  );
};

export const IpdBillingModule: React.FC<{
  activeAdmission: IpdAdmission;
  onUpdateAdmission: (data: Partial<IpdAdmission>) => void;
  billingRates: ServicePrices;
  setTemplateModal: any;
}> = ({
  activeAdmission,
  onUpdateAdmission,
  billingRates,
  setTemplateModal,
}) => {
  const [chargeName, setChargeName] = useState("");
  const [chargeAmount, setChargeAmount] = useState(0);
  const [activeTab, setActiveTab] = useState("ipd");
  const [discount, setDiscount] = useState(activeAdmission.discount || 0);

  const updateDiscount = (val: number) => {
    setDiscount(val);
    const currentTotal = (activeAdmission.charges || []).reduce(
      (sum, c) => sum + c.amount,
      0,
    );
    onUpdateAdmission({ discount: val, totalBill: currentTotal - val });
  };

  const handleAddCharge = (name?: string, amount?: number) => {
    if ((!name && !chargeName) || (!amount && chargeAmount === 0)) return;
    const newCharge: IpdCharge = {
      id: Date.now().toString() + Math.random(),
      date: new Date().toISOString(),
      description: name || chargeName,
      amount: amount || chargeAmount,
      category: activeTab as any,
    };
    const updatedCharges = [...(activeAdmission.charges || []), newCharge];
    const newTotal = updatedCharges.reduce((sum, c) => sum + c.amount, 0);
    onUpdateAdmission({
      charges: updatedCharges,
      totalBill: newTotal - discount,
    });
    setChargeName("");
    setChargeAmount(0);
  };

  const handleDeleteCharge = (id: string) => {
    if (confirm("Remove this charge?")) {
      const updatedCharges = (activeAdmission.charges || []).filter(
        (c) => c.id !== id,
      );
      const newTotal = updatedCharges.reduce(
        (sum, c) => sum + Number(c.amount),
        0,
      );
      onUpdateAdmission({
        charges: updatedCharges,
        totalBill: newTotal - discount,
      });
    }
  };

  const handleEditCharge = (
    id: string,
    field: "description" | "amount",
    value: any,
  ) => {
    const updatedCharges = (activeAdmission.charges || []).map((c) =>
      c.id === id ? { ...c, [field]: value } : c,
    );
    const newTotal = updatedCharges.reduce(
      (sum, c) => sum + Number(c.amount),
      0,
    );
    onUpdateAdmission({
      charges: updatedCharges,
      totalBill: newTotal - discount,
    });
  };

  const calculateRoomRent = () => {
    const start = new Date(activeAdmission.admissionDate);
    const end = new Date();
    const diff =
      Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) ||
      1;
    const rate = activeAdmission.dailyCharges || 0;
    handleAddCharge(`Room Charges (${diff} days @ ${rate})`, diff * rate);
  };

  const catalogItems = Object.values(billingRates).filter((item) => {
    if (activeTab === "ipd")
      return ["ipd", "round", "bed"].some((k) => item.category?.includes(k));
    return item.category === activeTab;
  });

  const totalCharges = (activeAdmission.charges || []).reduce(
    (sum, c) => sum + Number(c.amount),
    0,
  );

  const handlePrintBill = () => {
    const printWindow = window.open("", "", "width=800,height=600");
    if (!printWindow) return;
    printWindow.document.write(`
            <html><head><title>IPD Bill</title><style>
                body { font-family: sans-serif; padding: 20px; }
                table { w-full; border-collapse: collapse; margin-top: 20px; width: 100%; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                .text-right { text-align: right; }
            </style></head><body>
                <h2>IPD Final Bill</h2>
                <p>Date: ${new Date().toLocaleDateString()}</p>
                <table>
                    <thead><tr><th>Description</th><th class="text-right">Amount</th></tr></thead>
                    <tbody>
                        ${(activeAdmission.charges || []).map((c) => `<tr><td>${c.description}</td><td class="text-right">${c.amount}</td></tr>`).join("")}
                    </tbody>
                </table>
                <h3 class="text-right">Total: ${totalCharges}</h3>
                <h3 class="text-right">Discount: ${discount}</h3>
                <h2 class="text-right">Grand Total: ${totalCharges - discount}</h2>
                <script>window.print();</script>
            </body></html>
        `);
    printWindow.document.close();
  };

  const handlePrintReceipt = () => {
    const printWindow = window.open("", "", "width=800,height=600");
    if (!printWindow) return;
    printWindow.document.write(`
            <html><head><title>Payment Receipt</title><style>
                body { font-family: sans-serif; padding: 20px; }
                .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 10px; }
                .content { margin-top: 20px; line-height: 1.6; }
            </style></head><body>
                <div class="header">
                    <h2>Payment Receipt</h2>
                </div>
                <div class="content">
                    <p>Date: ${new Date().toLocaleDateString()}</p>
                    <p>Received with thanks the sum of <b>Rs. ${totalCharges - discount}/-</b> towards IPD services.</p>
                </div>
                <br/><br/><br/>
                <p style="text-align: right;">Authorized Signatory</p>
                <script>window.print();</script>
            </body></html>
        `);
    printWindow.document.close();
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative">
      <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight mb-4 flex justify-between items-center">
        IPD Billing
        <div className="flex gap-2">
          <button
            onClick={() =>
              setTemplateModal({
                isOpen: true,
                mode: "save",
                type: "bill_package",
                payload: JSON.stringify(activeAdmission.charges),
              })
            }
            className="bg-slate-100 text-slate-600 px-3 py-1 rounded text-[10px] font-bold uppercase"
          >
            Save Template
          </button>
          <button
            onClick={() =>
              setTemplateModal({
                isOpen: true,
                mode: "load",
                type: "bill_package",
                onLoad: (content: string) => {
                  try {
                    const loaded = JSON.parse(content);
                    const existing = activeAdmission.charges || [];
                    onUpdateAdmission({ charges: [...existing, ...loaded] });
                  } catch (e) {
                    console.error("Invalid template format", e);
                  }
                }
              })
            }
            className="bg-slate-100 text-slate-600 px-3 py-1 rounded text-[10px] font-bold uppercase"
          >
            Load Template
          </button>
        </div>
      </h3>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {[
          "ipd",
          "lab",
          "operation",
          "anesthesia",
          "medication_package",
          "procedure",
        ].map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveTab(cat)}
            className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase whitespace-nowrap ${activeTab === cat ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500"}`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="flex gap-4 mb-4 items-end">
        <div className="flex-grow">
          <input
            list="charge-catalog"
            placeholder="Charge Description"
            value={chargeName}
            onChange={(e) => {
              setChargeName(e.target.value);
              const match = Object.values(billingRates).find(
                (r) => r.name === e.target.value,
              );
              if (match) setChargeAmount(match.price);
            }}
            className="w-full border p-2 rounded-lg font-bold text-sm"
          />
          <datalist id="charge-catalog">
            {catalogItems.map((item, idx) => (
              <option key={`${item.name}-${idx}`} value={item.name}>
                {item.name} - ₹{item.price}
              </option>
            ))}
          </datalist>
        </div>
        <div className="w-32">
          <input
            type="number"
            placeholder="Amount"
            value={chargeAmount || ""}
            onChange={(e) => setChargeAmount(Number(e.target.value))}
            className="w-full border p-2 rounded-lg font-bold text-sm"
          />
        </div>
        <button
          onClick={() => handleAddCharge()}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-xs uppercase"
        >
          Add
        </button>
        {activeTab === "ipd" && (
          <button
            onClick={calculateRoomRent}
            className="bg-purple-100 text-purple-700 border border-purple-200 px-4 py-2 rounded-lg font-bold text-xs uppercase"
          >
            Auto Room Rent
          </button>
        )}
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 font-bold text-slate-500 uppercase">
            <tr>
              <th className="p-2">Date</th>
              <th className="p-2">Description</th>
              <th className="p-2 text-right">Amount</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {(activeAdmission.charges || []).map((c) => (
              <tr
                key={c.id}
                className="border-b last:border-0 hover:bg-slate-50"
              >
                <td className="p-2 text-xs text-slate-500">
                  {new Date(c.date).toLocaleDateString()}
                </td>
                <td className="p-2">
                  <input
                    value={c.description}
                    onChange={(e) =>
                      handleEditCharge(c.id, "description", e.target.value)
                    }
                    className="w-full bg-transparent outline-none font-medium"
                  />
                </td>
                <td className="p-2 text-right">
                  <input
                    type="number"
                    value={c.amount}
                    onChange={(e) =>
                      handleEditCharge(c.id, "amount", Number(e.target.value))
                    }
                    className="w-20 text-right bg-transparent outline-none font-bold"
                  />
                </td>
                <td className="p-2 text-center">
                  <button
                    onClick={() => handleDeleteCharge(c.id)}
                    className="text-red-400 hover:text-red-600 font-bold"
                  >
                    &times;
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="font-bold text-slate-500">Subtotal Charges</span>
          <span className="font-bold">₹{totalCharges}</span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="font-bold text-slate-500">Discount</span>
          <input
            type="number"
            value={discount}
            onChange={(e) => updateDiscount(Number(e.target.value))}
            className="w-24 border p-1 rounded text-right font-bold text-red-600"
          />
        </div>
        <div className="flex justify-between text-lg border-t border-slate-200 pt-2 mb-4">
          <span className="font-black text-slate-800 uppercase">
            Grand Total
          </span>
          <span className="font-black text-blue-600">
            ₹{totalCharges - discount}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => alert("Bill Saved Successfully")}
            className="flex-1 bg-green-600 text-white rounded-lg py-3 font-bold text-xs uppercase shadow hover:bg-green-700"
          >
            Save Bill
          </button>
          <button
            onClick={handlePrintBill}
            className="flex-1 bg-blue-600 text-white rounded-lg py-3 font-bold text-xs uppercase shadow hover:bg-blue-700"
          >
            Print Bill
          </button>
          <button
            onClick={handlePrintReceipt}
            className="flex-1 bg-purple-600 text-white rounded-lg py-3 font-bold text-xs uppercase shadow hover:bg-purple-700"
          >
            Print Receipt
          </button>
        </div>
      </div>
    </div>
  );
};



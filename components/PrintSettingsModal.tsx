
import React, { useState } from 'react';
import { AppPrintSettings, PageMargins } from '../types';
import { savePrintSettings } from '../services/printSettingsService';

interface PrintSettingsModalProps {
    initialSettings: AppPrintSettings;
    onClose: () => void;
    onSave: (newSettings: AppPrintSettings) => void;
}

const PrintSettingsModal: React.FC<PrintSettingsModalProps> = ({ initialSettings, onClose, onSave }) => {
    const [settings, setSettings] = useState<AppPrintSettings>(initialSettings);
    const [activeTab, setActiveTab] = useState<'lab' | 'prescription' | 'bill'>('lab');

    const handleChange = (section: keyof AppPrintSettings, field: keyof PageMargins, value: string) => {
        const numValue = parseFloat(value) || 0;
        setSettings(prev => ({
            ...prev,
            [section]: {
                ...prev[section],
                [field]: numValue
            }
        }));
    };

    const handleSave = () => {
        savePrintSettings(settings);
        onSave(settings);
        onClose();
    };

    const renderInputs = (section: keyof AppPrintSettings) => {
        const data = settings[section];
        return (
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Header Space (mm)</label>
                    <input type="number" value={data.headerHeight} onChange={e => handleChange(section, 'headerHeight', e.target.value)} className="w-full border p-2 rounded" />
                    <p className="text-[9px] text-slate-400 mt-1">Blank space at top for letterhead</p>
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Footer Space (mm)</label>
                    <input type="number" value={data.footerHeight} onChange={e => handleChange(section, 'footerHeight', e.target.value)} className="w-full border p-2 rounded" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Margin Top (mm)</label>
                    <input type="number" value={data.marginTop} onChange={e => handleChange(section, 'marginTop', e.target.value)} className="w-full border p-2 rounded" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Margin Bottom (mm)</label>
                    <input type="number" value={data.marginBottom} onChange={e => handleChange(section, 'marginBottom', e.target.value)} className="w-full border p-2 rounded" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Margin Left (mm)</label>
                    <input type="number" value={data.marginLeft} onChange={e => handleChange(section, 'marginLeft', e.target.value)} className="w-full border p-2 rounded" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Margin Right (mm)</label>
                    <input type="number" value={data.marginRight} onChange={e => handleChange(section, 'marginRight', e.target.value)} className="w-full border p-2 rounded" />
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[200] p-4">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col">
                <div className="bg-slate-900 text-white p-6 border-b border-slate-800 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-black uppercase tracking-widest">Print Settings</h2>
                        <p className="text-[10px] uppercase tracking-wider text-slate-400">Configure Page Layout & Margins</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl">&times;</button>
                </div>
                
                <div className="flex bg-slate-100 p-2 gap-2 border-b border-slate-200">
                    <button onClick={() => setActiveTab('lab')} className={`flex-1 py-2 rounded-lg font-bold text-xs uppercase ${activeTab === 'lab' ? 'bg-white text-blue-600 shadow' : 'text-slate-500'}`}>Lab Report</button>
                    <button onClick={() => setActiveTab('prescription')} className={`flex-1 py-2 rounded-lg font-bold text-xs uppercase ${activeTab === 'prescription' ? 'bg-white text-purple-600 shadow' : 'text-slate-500'}`}>Prescription</button>
                    <button onClick={() => setActiveTab('bill')} className={`flex-1 py-2 rounded-lg font-bold text-xs uppercase ${activeTab === 'bill' ? 'bg-white text-green-600 shadow' : 'text-slate-500'}`}>Bill / Invoice</button>
                </div>

                <div className="p-6">
                    {renderInputs(activeTab)}
                </div>

                <div className="p-6 bg-slate-50 border-t flex justify-end gap-4">
                    <button onClick={onClose} className="bg-white border border-slate-300 text-slate-700 px-6 py-2 rounded-xl font-bold uppercase text-xs">Cancel</button>
                    <button onClick={handleSave} className="bg-blue-600 text-white px-6 py-2 rounded-xl font-bold uppercase text-xs shadow-lg hover:bg-blue-700">Save Configuration</button>
                </div>
            </div>
        </div>
    );
};

export default PrintSettingsModal;

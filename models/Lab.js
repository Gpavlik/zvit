// models/Lab.js
const mongoose = require("mongoose");

const TenderSchema = new mongoose.Schema({
  title: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: "UAH" },
  status: { 
    type: String, 
    enum: ["active", "planned", "done", "canceled"], 
    default: "planned" 
  },
  deadline: { type: Date },
  winner: { type: String, default: null }
}, { _id: false });

const LabSchema = new mongoose.Schema({
  edrpou: { type: String, required: true, unique: true },
  institution: { type: String },
  region: { type: String },
  city: { type: String },
  address: { type: String },
  contractor: { type: String },
  phone: { type: String },
  email: { type: String },
  manager: { type: String },
  partner: { type: String },
  devices: { type: Array, default: [] },
  tasks: { type: Array, default: [] },
  tenders: { type: [TenderSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Lab", LabSchema);

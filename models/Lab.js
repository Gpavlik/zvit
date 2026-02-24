// models/Lab.js
const mongoose = require("mongoose");

const TenderSchema = new mongoose.Schema({
  title: { type: String, required: true },        // потреба
  amount: { type: Number, required: true },       // можливість
  currency: { type: String, default: "UAH" },     // валюта
  status: { 
    type: String, 
    enum: ["active", "planned", "done", "canceled"], 
    default: "planned" 
  },                                              // стан тендеру
  deadline: { type: Date },                       // кінцевий термін
  winner: { type: String, default: null }         // переможець
}, { _id: false });

const LabSchema = new mongoose.Schema({
  _id: { type: String, required: true },          // UUID або ObjectId як рядок
  partner: String,
  region: String,
  city: String,
  institution: String,
  address: String,
  contractor: String,
  phone: String,
  email: String,
  edrpou: { type: String, index: true },
  manager: String,
  lat: Number,
  lng: Number,

  devices: [{
    category: String,
    name: String,
    rent: Boolean,
    debt: Boolean,
    date: Date,
    quantity: Number,
    reagents: [{
      name: String,
      quantity: Number,
      date: Date
    }],
    purchases: [{
      date: Date,
      quantity: Number
    }]
  }],

  tenders: [TenderSchema],                        // масив тендерів

  tasks: [{
    title: String,
    date: Date,
    tasks: [{
      priority: String,
      action: String,
      device: String
    }]
  }],

  districts: [String]
}, { timestamps: true });

module.exports = mongoose.model("Lab", LabSchema);

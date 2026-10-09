/** Application groups shared by the portal form and its saved read-only presentation. */
export const SAMPLE_APPLICATION_GROUPS = Object.freeze([
  {name:'Product type',selector:'.detaildata_kat1',required:true,options:['Ready to use','Premix']},
  {name:'Product application',selector:'.detaildata_kat2',required:true,options:['Oil Slurry','Sugar Coating','Ready To Serve','Sprinkle','Dough']},
  {name:'Flavoring type',selector:'.detaildata_kat4',required:false,options:['Oil Soluble','Water soluble']},
]);

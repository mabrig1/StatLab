// Deterministic, explicitly synthetic data used only to teach interface navigation.
// No network requests, real finance datasets, respondent data or numerical model fits.
const generator=()=>{
  let seed=20261119>>>0;
  return ()=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return (seed+0.5)/4294967296;
  };
};
export function syntheticTimeSeries(kind){
  const uniform=generator();
  if(kind==="arima"){
    const rows=[["month","value"]];
    let x=18;
    for(let i=0;i<96;i++){
      x=5+0.72*x+(uniform()-0.5)*2.3;
      const month=String(1+i%12).padStart(2,"0");
      rows.push([String(2018+Math.floor(i/12))+"-"+month,x.toFixed(5)]);
    }
    return rows;
  }
  if(kind==="garch"){
    const rows=[["date","price"]];
    const gaussian=()=>Math.sqrt(-2*Math.log(uniform()))*Math.cos(2*Math.PI*uniform());
    let variance=1.1,error=0,price=120;
    for(let i=0;i<320;i++){
      variance=0.09+0.12*error*error+0.80*variance;
      error=Math.sqrt(variance)*gaussian();
      price*=Math.exp((0.06+error)/100);
      rows.push([new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10),price.toFixed(6)]);
    }
    return rows;
  }
  throw Error("Unknown synthetic practice dataset.");
}

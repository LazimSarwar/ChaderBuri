/** Native datetime-local values are interpreted as UTC, never host local time.
 * Reject partial/nonexistent dates, fractional cache hours and incomplete missions. */
export function landingRow(value:string,startMs:number,hours:number,missionDays:number):number|null{
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::00(?:\.0+)?)?$/.test(value))return null
 const parsed=Date.parse(value+'Z')
 if(!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,16)!==value.slice(0,16))return null
 const row=(parsed-startMs)/3600000
 return Number.isInteger(row)&&row>=0&&row+missionDays*24<=hours?row:null
}

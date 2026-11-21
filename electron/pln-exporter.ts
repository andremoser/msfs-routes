import { SuggestedRoute } from '../shared/types';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function formatMsfsCoordinate(lat: number, lon: number, elevationFt: number): string {
  const formatPart = (val: number, posHem: string, negHem: string): string => {
    const hem = val >= 0 ? posHem : negHem;
    const abs = Math.abs(val);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = (minFloat - min) * 60;
    return `${hem}${deg}° ${min}' ${sec.toFixed(2)}"`;
  };

  const altSign = elevationFt >= 0 ? '+' : '-';
  const altAbs = Math.abs(elevationFt).toFixed(2).padStart(9, '0');
  return `${formatPart(lat, 'N', 'S')},${formatPart(lon, 'E', 'W')},${altSign}${altAbs}`;
}

export function buildMsfsPlnXml(route: SuggestedRoute): string {
  const { origin, destination, aircraft } = route;
  const title = `${origin.icao} to ${destination.icao}`;
  const descr = `${origin.city} (${origin.icao}) to ${destination.city} (${destination.icao}) - ${aircraft.icao}`;
  const cruiseAlt = aircraft.typicalCruiseAltFt || 10000;

  const depWorldPos = formatMsfsCoordinate(origin.lat, origin.lon, origin.elevationFt);
  const arrWorldPos = formatMsfsCoordinate(destination.lat, destination.lon, destination.elevationFt);

  return `<?xml version="1.0" encoding="UTF-8"?>
<SimBase.Document Type="AceXML" version="1,0">
    <Descr>AceXML Document</Descr>
    <FlightPlan.FlightPlan>
        <Title>${escapeXml(title)}</Title>
        <FPType>IFR</FPType>
        <RouteType>Direct</RouteType>
        <CruisingAlt>${cruiseAlt}.000</CruisingAlt>
        <DepartureID>${escapeXml(origin.icao)}</DepartureID>
        <DepartureLLA>${escapeXml(depWorldPos)}</DepartureLLA>
        <DestinationID>${escapeXml(destination.icao)}</DestinationID>
        <DestinationLLA>${escapeXml(arrWorldPos)}</DestinationLLA>
        <Descr>${escapeXml(descr)}</Descr>
        <DepartureName>${escapeXml(origin.name)}</DepartureName>
        <DestinationName>${escapeXml(destination.name)}</DestinationName>
        <AppVersion>
            <AppVersionMajor>12</AppVersionMajor>
            <AppVersionBuild>282174</AppVersionBuild>
        </AppVersion>
        <ATCWaypoint id="${escapeXml(origin.icao)}">
            <ATCWaypointType>Airport</ATCWaypointType>
            <WorldPosition>${escapeXml(depWorldPos)}</WorldPosition>
            <ICAO>
                <ICAOIdent>${escapeXml(origin.icao)}</ICAOIdent>
            </ICAO>
        </ATCWaypoint>
        <ATCWaypoint id="${escapeXml(destination.icao)}">
            <ATCWaypointType>Airport</ATCWaypointType>
            <WorldPosition>${escapeXml(arrWorldPos)}</WorldPosition>
            <ICAO>
                <ICAOIdent>${escapeXml(destination.icao)}</ICAOIdent>
            </ICAO>
        </ATCWaypoint>
    </FlightPlan.FlightPlan>
</SimBase.Document>
`;
}

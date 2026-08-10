"""Acesso direto aos arquivos oficiais do DATASUS em Python 3.14.

Os arquivos DBC/DBF são baixados do FTP público diretamente para memória,
lidos como DataFrame e descartados. Nenhum formato intermediário é persistido;
os orquestradores continuam gravando somente os Parquets finais do Atlas.
"""

from __future__ import annotations

import struct
from ftplib import FTP, all_errors, error_perm
from io import BytesIO
from typing import Iterable, Sequence

import pandas as pd

import climasus_readdbc


DATASUS_FTP_HOST = "ftp.datasus.gov.br"
CNES_DIRECTORY = "/dissemin/publicos/CNES/200508_/Dados"
SIM_DIRECTORY = "/dissemin/publicos/SIM/CID10/DORES"
SINASC_DIRECTORIES = (
    "/dissemin/publicos/SINASC/NOV/DNRES",
    "/dissemin/publicos/SINASC/ANT/DNRES",
)
PNI_DIRECTORY = "/dissemin/publicos/PNI/DADOS"


def cnes_filename(group: str, uf: str, year: int, month: int) -> str:
    return f"{group.upper()}{uf.upper()}{year % 100:02d}{month:02d}.dbc"


def sim_filename(uf: str, year: int) -> str:
    return f"DO{uf.upper()}{year:04d}.dbc"


def sinasc_filename(uf: str, year: int) -> str:
    return f"DN{uf.upper()}{year:04d}.dbc"


def pni_filename(uf: str, year: int) -> str:
    return f"CPNI{uf.upper()}{year % 100:02d}.dbf"


def _read_dbf_selected(
    data: bytes,
    columns: Sequence[str],
    encoding: str = "latin1",
) -> pd.DataFrame:
    """Leia somente as colunas solicitadas de um DBF em memória.

    O leitor genérico do pacote materializa todas as colunas como objetos
    Python antes de criar o DataFrame. Em arquivos CNES/PF com mais de um
    milhão de registros isso produz um pico de memória desnecessário. Aqui
    cada coluna é decodificada separadamente e convertida imediatamente para
    Arrow string, mantendo na memória apenas os campos usados pelo indicador.
    """
    if len(data) < 32:
        raise ValueError("DBF inválido: cabeçalho incompleto")

    n_records = struct.unpack_from("<I", data, 4)[0]
    header_size = struct.unpack_from("<H", data, 8)[0]
    record_size = struct.unpack_from("<H", data, 10)[0]
    if header_size < 33 or header_size > len(data) or record_size == 0:
        raise ValueError("DBF inválido: dimensões do cabeçalho inconsistentes")

    requested = list(dict.fromkeys(columns))
    requested_set = set(requested)
    descriptors: dict[str, tuple[int, int]] = {}
    seen: dict[str, int] = {}
    descriptor_offset = 32
    value_offset = 1  # primeiro byte do registro é a marca de exclusão

    while descriptor_offset < header_size - 1:
        if data[descriptor_offset] == 0x0D:
            break
        raw_name = data[descriptor_offset : descriptor_offset + 11]
        base_name = (
            raw_name.split(b"\x00", 1)[0]
            .decode("ascii", errors="replace")
            .strip()
        )
        field_length = data[descriptor_offset + 16]
        duplicate_index = seen.get(base_name, 0)
        seen[base_name] = duplicate_index + 1
        field_name = (
            base_name if duplicate_index == 0 else f"{base_name}_{duplicate_index + 1}"
        )
        if field_name in requested_set:
            descriptors[field_name] = (value_offset, field_length)
        value_offset += field_length
        descriptor_offset += 32

    missing = [column for column in requested if column not in descriptors]
    if missing:
        raise ValueError(
            "DBF não contém as colunas esperadas: " + ", ".join(missing)
        )

    max_records = max(0, (len(data) - header_size) // record_size)
    actual_records = min(n_records, max_records)
    view = memoryview(data)
    arrays = {}
    for column in requested:
        relative_offset, field_length = descriptors[column]
        values: list[str | None] = []
        append = values.append
        for index in range(actual_records):
            record_offset = header_size + index * record_size
            deletion_flag = data[record_offset]
            if deletion_flag == 0x2A:
                continue
            if deletion_flag == 0x1A:
                break
            start = record_offset + relative_offset
            raw_value = view[start : start + field_length]
            value = raw_value.tobytes().decode(encoding, errors="replace").strip()
            append(value or None)
        arrays[column] = pd.array(values, dtype="string[pyarrow]")

    return pd.DataFrame(arrays, copy=False)


class DatasusFTPSource:
    """Cliente mínimo para baixar e ler tabelas oficiais sem arquivo local."""

    def __init__(self, timeout: int = 120, retries: int = 3):
        self.timeout = timeout
        self.retries = retries
        self._ftp: FTP | None = None

    def __enter__(self) -> "DatasusFTPSource":
        self._connect()
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.close()

    def _connect(self) -> FTP:
        if self._ftp is None:
            ftp = FTP(DATASUS_FTP_HOST, timeout=self.timeout)
            ftp.login()
            ftp.set_pasv(True)
            self._ftp = ftp
        return self._ftp

    def close(self) -> None:
        if self._ftp is None:
            return
        try:
            self._ftp.quit()
        except all_errors:
            self._ftp.close()
        finally:
            self._ftp = None

    def _reset_connection(self) -> None:
        self.close()
        self._connect()

    def _download(self, directory: str, filename: str) -> bytes:
        last_error: Exception | None = None
        for attempt in range(1, self.retries + 1):
            output = BytesIO()
            try:
                ftp = self._connect()
                ftp.cwd(directory)
                ftp.retrbinary(f"RETR {filename}", output.write)
                return output.getvalue()
            except error_perm as exc:
                if str(exc).startswith("550"):
                    raise FileNotFoundError(
                        f"Arquivo DATASUS não encontrado: {directory}/{filename}"
                    ) from exc
                raise
            except all_errors as exc:
                last_error = exc
                if attempt < self.retries:
                    self._reset_connection()

        raise ConnectionError(
            f"Falha ao baixar {directory}/{filename} após {self.retries} tentativas"
        ) from last_error

    def read_table(
        self,
        directory: str,
        filename: str,
        columns: Sequence[str] | None = None,
    ) -> pd.DataFrame:
        raw = self._download(directory, filename)
        if filename.lower().endswith(".dbc"):
            if columns is None:
                return climasus_readdbc.read_dbc(raw, encoding="latin1")
            dbf_data = climasus_readdbc.dbc_to_dbf(raw)
            del raw
        elif filename.lower().endswith(".dbf"):
            if columns is None:
                return climasus_readdbc.read_dbf(raw, encoding="latin1")
            dbf_data = raw
        else:
            raise ValueError(f"Formato DATASUS não suportado: {filename}")

        try:
            return _read_dbf_selected(dbf_data, columns, encoding="latin1")
        except ValueError as exc:
            raise ValueError(f"{filename}: {exc}") from exc

    def read_first_available(
        self,
        candidates: Iterable[tuple[str, str]],
        columns: Sequence[str] | None = None,
    ) -> pd.DataFrame:
        attempted: list[str] = []
        for directory, filename in candidates:
            attempted.append(f"{directory}/{filename}")
            try:
                return self.read_table(directory, filename, columns)
            except FileNotFoundError:
                continue
        raise FileNotFoundError(
            "Nenhum arquivo DATASUS candidato foi encontrado: " + ", ".join(attempted)
        )

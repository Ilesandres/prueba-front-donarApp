import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface Report {
  id: number;
  comments: {
    report: string;
    extraComments: string;
    postReport: string;
  };
  createdAt: string;
  updatedAt: string;
  user: {
    id: number;
    username: string;
    profilePhoto: string;
  };
}

export interface ReportResponse {
  items: Report[];
  cursor?: string;
  hasMore?: boolean;
}

export interface ReportFilters {
  limit?: number;
  search?: string;
  cursor?: string;
  orderBy?: string;
  order?: 'ASC' | 'DESC';
}

@Injectable({
  providedIn: 'root'
})
export class ReportService {
  private apiUrl = `${environment.apiBackendUrl}/report`;

  constructor(private http: HttpClient) {}

  /**
   * Obtener lista de reportes con scroll infinito y filtros
   */
  getReports(filters?: ReportFilters): Observable<ReportResponse> {
    let params = new HttpParams();

    if (filters?.limit && filters.limit > 0) {
      params = params.set('limit', filters.limit.toString());
    }

    if (filters?.search && filters.search.trim() !== '') {
      params = params.set('search', filters.search);
    }

    if (filters?.cursor && filters.cursor.trim() !== '') {
      params = params.set('cursor', filters.cursor);
    }

    if (filters?.orderBy && filters.orderBy.trim() !== '') {
      params = params.set('orderBy', filters.orderBy);
    }

    if (filters?.order && (filters.order === 'ASC' || filters.order === 'DESC')) {
      params = params.set('order', filters.order);
    }

    return this.http.get<ReportResponse>(`${this.apiUrl}/list`, { params }).pipe(
      map(response => {
        // Asegurar que items siempre sea un array
        return {
          items: Array.isArray(response.items) ? response.items : (response.items ? [response.items] : []),
          cursor: response.cursor,
          hasMore: response.hasMore
        };
      })
    );
  }

  /**
   * Crear un nuevo reporte
   */
  createReport(data: {
    report: string;
    extraComments?: string;
    postReport?: string;
    acknowledgmentId?: number;
  }): Observable<{ message: string; success: boolean; reportId?: number }> {
    return this.http.post<{ message: string; success: boolean; reportId?: number }>(`${this.apiUrl}/create/new`, data);
  }
}

